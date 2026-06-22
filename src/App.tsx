import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Upload,
  Trash2,
  Download,
  FileText,
  X,
  CheckSquare,
  Square,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Info,
  LayoutGrid,
  Image as ImageIcon
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Render-slot semaphore
// Limits concurrent PDF.js page renders so the worker isn't flooded with
// tasks all at once. This gives progressive visual feedback (pages appear
// one by one) instead of every visible thumbnail waiting in parallel and
// then all popping in simultaneously.
// ---------------------------------------------------------------------------
const MAX_CONCURRENT_RENDERS = 4;
let activeRenders = 0;
const renderWaiters: Array<() => void> = [];

function acquireRenderSlot(): Promise<void> {
  return new Promise<void>(resolve => {
    if (activeRenders < MAX_CONCURRENT_RENDERS) {
      activeRenders++;
      resolve();
    } else {
      renderWaiters.push(() => { activeRenders++; resolve(); });
    }
  });
}

function releaseRenderSlot(): void {
  activeRenders--;
  renderWaiters.shift()?.();
}


const PageThumbnail = memo(({
  index,
  pdfProxy,
  firstDirtyIndex,
  isSelected,
  actionMode,
  quality,
  onToggle,
  onSelectOnly
}: {
  index: number;
  pdfProxy: pdfjs.PDFDocumentProxy;
  firstDirtyIndex: number;
  isSelected: boolean;
  actionMode: 'remove' | 'keep';
  quality: number;
  onToggle: (index: number, isShiftKey: boolean) => void;
  onSelectOnly: (index: number) => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  // Track last rendered quality to distinguish quality-change from proxy-change
  const prevQualityRef = useRef<number>(quality);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '600px', threshold: 0.01 }); // render even slightly earlier

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const qualityChanged = quality !== prevQualityRef.current;
    prevQualityRef.current = quality;

    // Re-render this page only if:
    //   a) the quality setting changed (always affects every page), OR
    //   b) this page's content may have changed in the new document
    //      (i.e. its index is at or after the first page that was modified)
    //
    // Pages BEFORE firstDirtyIndex are guaranteed to have identical content
    // in the new document (e.g. pages before the removed/added page), so we
    // skip clearing their canvas — they stay rendered with the correct image.
    if (qualityChanged || index >= firstDirtyIndex) {
      setRendered(false);
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    // NOTE: No cleanup return here. Returning a cleanup would clear the canvas
    // on every dep change, wiping unchanged pages. Instead, unmount-only
    // cleanup is handled by the dedicated effect below.
  }, [pdfProxy, quality, index, firstDirtyIndex]);

  // Free GPU/bitmap memory immediately when this component is removed from the
  // tree (e.g. after removing the last page). This is intentionally separate
  // from the effect above so it only runs on unmount, not on every dep change.
  useEffect(() => {
    return () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, []);

  useEffect(() => {
    let renderTask: any = null;
    let isCancelled = false;
    let page: any = null;
    let slotAcquired = false;

    if (isVisible && !rendered && pdfProxy && canvasRef.current) {
      const renderPage = async () => {
        try {
          // Acquire a slot — if MAX_CONCURRENT_RENDERS slots are taken, this
          // awaits until one is released. Check isCancelled afterwards in case
          // the component unmounted or deps changed while waiting in the queue.
          await acquireRenderSlot();
          slotAcquired = true;
          if (isCancelled) return;

          page = await pdfProxy.getPage(index + 1);
          if (isCancelled) return;

          const viewport = page.getViewport({ scale: quality });
          const canvas = canvasRef.current;
          if (!canvas) return;

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext('2d');

          if (context) {
            renderTask = page.render({ canvasContext: context, viewport, canvas });
            await renderTask.promise;
            if (!isCancelled) {
              setRendered(true);
            }
          }
        } catch (err: any) {
          // Ignore cancellation errors
          if (err?.name === 'RenderingCancelledException') return;
          console.error(`Error rendering page ${index + 1}:`, err?.message || err);
        } finally {
          if (slotAcquired) releaseRenderSlot();
          if (page) page.cleanup();
        }
      };
      renderPage();
    }

    return () => {
      isCancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [isVisible, rendered, index, pdfProxy, quality]);

  return (
    <motion.div
      ref={containerRef}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -4 }}
      onClick={(e) => onToggle(index, e.shiftKey)}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-xl border-2 bg-white transition-all select-none",
        isSelected
          ? (actionMode === 'remove' ? "border-red-500 ring-4 ring-red-50" : "border-blue-500 ring-4 ring-blue-50")
          : "border-neutral-200 hover:border-neutral-300"
      )}
    >
      <div className="aspect-[3/4] overflow-hidden bg-neutral-100 flex items-center justify-center">
        {!rendered && <Loader2 className="animate-spin text-neutral-400" size={24} />}
        <canvas
          ref={canvasRef}
          className={cn("w-full h-full object-contain bg-white", !rendered && "hidden")}
        />
      </div>

      <div className={cn(
        "flex items-center justify-between border-t p-2 transition-colors",
        isSelected
          ? (actionMode === 'remove' ? "bg-red-50 border-red-100" : "bg-blue-50 border-blue-100")
          : "bg-white border-neutral-100"
      )}>
        <span className={cn(
          "text-xs font-bold",
          isSelected
            ? (actionMode === 'remove' ? "text-red-700" : "text-blue-700")
            : "text-neutral-500"
        )}>
          Page {index + 1}
        </span>
        {isSelected ? (
          <CheckSquare size={16} className={actionMode === 'remove' ? "text-red-600" : "text-blue-600"} />
        ) : (
          <Square size={16} className="text-neutral-300 group-hover:text-neutral-400" />
        )}
      </div>

      {/* Hover Overlay for Single Remove/Keep Selection */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/5 group-hover:opacity-100">
        {!isSelected && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectOnly(index);
            }}
            className={cn(
              "rounded-full bg-white p-2 text-neutral-900 shadow-lg transition-colors",
              actionMode === 'remove' ? "hover:bg-red-600 hover:text-white" : "hover:bg-blue-600 hover:text-white"
            )}
          >
            <CheckSquare size={20} />
          </button>
        )}
      </div>
    </motion.div>
  );
});

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfProxy, setPdfProxy] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<'remove' | 'keep'>('remove');
  const [previewQuality, setPreviewQuality] = useState<number>(0.4);
  const [previewSize, setPreviewSize] = useState<'small' | 'medium' | 'large'>('medium');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Keep a ref to the current proxy so we can destroy it before replacing
  const pdfProxyRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  // firstDirtyIndex: the lowest page index whose content changed in the latest
  // document update. PageThumbnails at indices below this skip re-rendering.
  const [firstDirtyIndex, setFirstDirtyIndex] = useState<number>(0);

  // Accepts a Blob (or File) and loads it into PDF.js via a blob URL.
  // This avoids creating an extra copy of the bytes in the main thread —
  // the worker streams directly from the existing blob.
  // dirtyFrom: lowest page index whose content changed. Thumbnails below this
  // index skip re-rendering since their content is identical in the new doc.
  const loadPdfProxy = useCallback(async (pdfBlob: Blob, dirtyFrom = 0) => {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(pdfBlob);
      const loadingTask = pdfjs.getDocument({
        url,
        disableAutoFetch: true,
        disableStream: true,
      });
      const pdf = await loadingTask.promise;
      if (pdfProxyRef.current) {
        pdfProxyRef.current.destroy().catch(() => {});
      }
      pdfProxyRef.current = pdf;
      // React 18 batches all three into a single re-render
      setPdfProxy(pdf);
      setTotalPages(pdf.numPages);
      setFirstDirtyIndex(dirtyFrom);
    } catch (err) {
      console.error('Error parsing PDF data:', err);
      setError('Failed to load PDF.');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile || uploadedFile.type !== 'application/pdf') {
      setError('Please upload a valid PDF file.');
      return;
    }

    setError(null);
    setIsProcessing(true);
    setFile(uploadedFile);
    setPdfProxy(null);
    setTotalPages(0);
    setSelectedPages(new Set());
    setLastSelectedIndex(null);

    // File extends Blob — pass it directly, no FileReader copy needed
    await loadPdfProxy(uploadedFile);
    setIsProcessing(false);
  };

  const togglePageSelection = useCallback((index: number, isShiftKey: boolean) => {
    setSelectedPages(prev => {
      const newSelected = new Set(prev);
      if (isShiftKey && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
          newSelected.add(i);
        }
      } else {
        if (newSelected.has(index)) {
          newSelected.delete(index);
        } else {
          newSelected.add(index);
        }
      }
      return newSelected;
    });
    setLastSelectedIndex(index);
  }, [lastSelectedIndex]);

  const selectOnlyPage = useCallback((index: number) => {
    setSelectedPages(new Set([index]));
    setLastSelectedIndex(index);
  }, []);

  const processPdf = async () => {
    if (!file || selectedPages.size === 0) return;

    setIsProcessing(true);
    try {
      // Use `let` so we can null references early and hint the GC
      let arrayBuffer: ArrayBuffer | null = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      arrayBuffer = null; // release — pdf-lib has parsed it, we no longer need it

      let indicesToRemove: number[] = [];
      let dirtyFrom: number;

      if (actionMode === 'remove') {
        indicesToRemove = Array.from(selectedPages);
        // Pages before the first removed page are identical in the new doc
        dirtyFrom = Math.min(...Array.from(selectedPages));
      } else {
        // Keep mode: remove all pages EXCEPT selected ones
        const allIndices = Array.from({ length: pdfDoc.getPageCount() }, (_, i) => i);
        indicesToRemove = allIndices.filter(i => !selectedPages.has(i));
        // Find first slot where the kept page's original index != slot position
        // e.g. keeping {0,1,2}: all unchanged → dirtyFrom = 3
        //      keeping {0,2,5}: slot 1 gets page 2, not page 1 → dirtyFrom = 1
        const sortedKept = Array.from(selectedPages).sort((a, b) => a - b);
        dirtyFrom = sortedKept.length; // assume all kept pages map 1:1
        for (let i = 0; i < sortedKept.length; i++) {
          if (sortedKept[i] !== i) { dirtyFrom = i; break; }
        }
      }

      // Sort indices in descending order to avoid index shifting issues
      indicesToRemove.sort((a: number, b: number) => b - a);
      indicesToRemove.forEach((index: number) => pdfDoc.removePage(index));

      let pdfBytes: Uint8Array | null = await pdfDoc.save();
      const newBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      pdfBytes = null;

      const newFile = new File([newBlob], file.name, { type: 'application/pdf' });
      setFile(newFile);
      setSelectedPages(new Set());
      setLastSelectedIndex(null);
      await loadPdfProxy(newBlob, dirtyFrom);
    } catch (err) {
      console.error('Error processing PDF:', err);
      setError('Failed to process PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const insertEmptyPage = async (position: 'start' | 'end') => {
    if (!file) return;

    setIsProcessing(true);
    try {
      let arrayBuffer: ArrayBuffer | null = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      arrayBuffer = null; // release early

      const pageCount = pdfDoc.getPageCount();
      if (pageCount === 0) {
        throw new Error('PDF has no pages.');
      }

      const referencePage = position === 'start'
        ? pdfDoc.getPage(0)
        : pdfDoc.getPage(pageCount - 1);
      const { width, height } = referencePage.getSize();

      if (position === 'start') {
        pdfDoc.insertPage(0, [width, height]);
      } else {
        pdfDoc.addPage([width, height]);
      }

      let pdfBytes: Uint8Array | null = await pdfDoc.save();
      const newBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      pdfBytes = null;

      // Insert at end: all existing pages are unchanged → dirtyFrom = old count
      // Insert at start: all pages shift by 1 → dirtyFrom = 0
      const dirtyFrom = position === 'end' ? pageCount : 0;

      const newFile = new File([newBlob], file.name, { type: 'application/pdf' });
      setFile(newFile);
      setSelectedPages(new Set());
      setLastSelectedIndex(null);
      await loadPdfProxy(newBlob, dirtyFrom);
    } catch (err) {
      console.error('Error adding blank page:', err);
      setError('Failed to add blank page.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPdf = async () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `edited_${file.name}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    // Destroy the document proxy to free worker memory
    if (pdfProxyRef.current) {
      pdfProxyRef.current.destroy().catch(() => {});
      pdfProxyRef.current = null;
    }
    setFile(null);
    setPdfProxy(null);
    setTotalPages(0);
    setSelectedPages(new Set());
    setLastSelectedIndex(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-neutral-50 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-neutral-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-200">
              <FileText size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">PDF Editor</h1>
          </div>

          {file && (
            <div className="flex items-center gap-3">
              <button
                onClick={reset}
                className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 sm:flex"
              >
                <X size={18} />
                Reset
              </button>
              <button
                onClick={downloadPdf}
                disabled={isProcessing}
                className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-neutral-800 disabled:opacity-50"
              >
                <Download size={18} />
                Download
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <AnimatePresence mode="wait">
          {!file ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <div
                onClick={() => fileInputRef.current?.click()}
                className="group relative flex h-80 w-full max-w-2xl cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-neutral-300 bg-white transition-all hover:border-red-500 hover:bg-red-50/30"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".pdf"
                  className="hidden"
                />
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-neutral-50 text-neutral-400 transition-colors group-hover:bg-red-100 group-hover:text-red-600">
                  <Upload size={40} />
                </div>
                <h2 className="mb-2 text-2xl font-semibold text-neutral-900">Upload PDF</h2>
                <p className="text-neutral-500">Drag and drop your file here, or click to browse</p>
                <p className="mt-8 text-xs font-medium uppercase tracking-widest text-neutral-400">Supported: .pdf</p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              {/* Toolbar */}
              <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-neutral-900">{file.name}</span>
                      <span className="text-xs text-neutral-500">{totalPages} pages total</span>
                    </div>
                    <div className="h-8 w-px bg-neutral-200" />
                    <div className="flex items-center gap-2 text-sm font-medium text-neutral-600">
                      <span className={cn(
                        "flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-neutral-100 px-1.5 text-xs",
                        selectedPages.size > 0 && (actionMode === 'remove' ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700")
                      )}>
                        {selectedPages.size}
                      </span>
                      selected
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="mr-2 flex items-center rounded-lg bg-neutral-100 p-1">
                      <button
                        onClick={() => setActionMode('remove')}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                          actionMode === 'remove' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                        )}
                      >
                        Remove Mode
                      </button>
                      <button
                        onClick={() => setActionMode('keep')}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                          actionMode === 'keep' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                        )}
                      >
                        Keep Mode
                      </button>
                    </div>
                    <button
                      onClick={() => setSelectedPages(new Set(Array.from({ length: totalPages }, (_, i) => i)))}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedPages(new Set())}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                    >
                      Clear
                    </button>
                    <button
                      onClick={processPdf}
                      disabled={selectedPages.size === 0 || isProcessing}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-all disabled:opacity-50",
                        actionMode === 'remove' ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                      )}
                    >
                      {isProcessing ? <Loader2 className="animate-spin" size={18} /> : (actionMode === 'remove' ? <Trash2 size={18} /> : <Download size={18} />)}
                      {actionMode === 'remove' ? 'Remove Selected' : 'Keep Selected'}
                    </button>
                    <button
                      onClick={() => insertEmptyPage('start')}
                      disabled={isProcessing}
                      className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Add Blank Page Start
                    </button>
                    <button
                      onClick={() => insertEmptyPage('end')}
                      disabled={isProcessing}
                      className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Add Blank Page End
                    </button>
                  </div>
                </div>
              </div>

              {/* View Settings */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl bg-white p-3 border border-neutral-100 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-neutral-500 font-medium px-1">
                  View Settings
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <LayoutGrid className="text-neutral-400" size={16} />
                    <label className="text-sm font-medium text-neutral-600">Size</label>
                    <select
                      value={previewSize}
                      onChange={(e) => setPreviewSize(e.target.value as any)}
                      className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm text-neutral-700 outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400"
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </div>
                  <div className="w-px h-6 bg-neutral-200 hidden sm:block" />
                  <div className="flex items-center gap-2">
                    <ImageIcon className="text-neutral-400" size={16} />
                    <label className="text-sm font-medium text-neutral-600">Quality</label>
                    <select
                      value={previewQuality}
                      onChange={(e) => setPreviewQuality(Number(e.target.value))}
                      className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm text-neutral-700 outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400"
                    >
                      <option value={0.2}>Low</option>
                      <option value={0.4}>Medium</option>
                      <option value={0.8}>High</option>
                      <option value={1.5}>Ultra</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Info Banner */}
              <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-4 text-blue-800">
                <Info className="mt-0.5 shrink-0" size={18} />
                <div className="text-sm">
                  <p className="font-semibold">Pro Tip: Range Selection</p>
                  <p className="opacity-90">Click a page, then hold <kbd className="rounded bg-blue-100 px-1 font-mono text-xs font-bold">Shift</kbd> and click another page to select a range instantly.</p>
                </div>
              </div>

              {/* Grid */}
              {isProcessing && !pdfProxy ? (
                <div className="flex h-64 flex-col items-center justify-center gap-4">
                  <Loader2 className="animate-spin text-red-600" size={40} />
                  <p className="text-neutral-500 animate-pulse">Loading PDF...</p>
                </div>
              ) : (
                <div className={cn(
                  "grid gap-4 sm:gap-6 select-none",
                  previewSize === 'small' && "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10",
                  previewSize === 'medium' && "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
                  previewSize === 'large' && "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4"
                )}>
                  {pdfProxy && Array.from({ length: totalPages }).map((_, index) => (
                    <PageThumbnail
                      key={index}
                      index={index}
                      pdfProxy={pdfProxy}
                      firstDirtyIndex={firstDirtyIndex}
                      actionMode={actionMode}
                      quality={previewQuality}
                      isSelected={selectedPages.has(index)}
                      onToggle={togglePageSelection}
                      onSelectOnly={selectOnlyPage}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-red-600 px-6 py-3 text-sm font-medium text-white shadow-xl z-50">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
