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

const PageThumbnail = memo(({ 
  index, 
  pdfProxy, 
  isSelected, 
  actionMode, 
  quality,
  onToggle,
  onSelectOnly
}: { 
  index: number; 
  pdfProxy: pdfjs.PDFDocumentProxy; 
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
    // Re-render if pdfProxy changes (e.g. after removing pages)
    setRendered(false);
  }, [pdfProxy, quality]);

  useEffect(() => {
    let renderTask: any = null;
    let isCancelled = false;
    let page: any = null;

    if (isVisible && !rendered && pdfProxy && canvasRef.current) {
      const renderPage = async () => {
        try {
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
          if (page) {
            page.cleanup();
          }
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

  const loadPdfProxy = async (pdfData: Uint8Array) => {
    try {
      const loadingTask = pdfjs.getDocument({ 
        data: pdfData,
        disableAutoFetch: true,
        disableStream: true,
      });
      const pdf = await loadingTask.promise;
      setPdfProxy(pdf);
      setTotalPages(pdf.numPages);
    } catch (err) {
      console.error('Error parsing PDF data:', err);
      setError('Failed to load PDF.');
    }
  };

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

    const reader = new FileReader();
    reader.onload = async (event) => {
      if (event.target?.result instanceof ArrayBuffer) {
        await loadPdfProxy(new Uint8Array(event.target.result));
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(uploadedFile);
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
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      
      let indicesToRemove: number[] = [];
      
      if (actionMode === 'remove') {
        indicesToRemove = Array.from(selectedPages);
      } else {
        // Keep mode: remove all pages EXCEPT selected ones
        const allIndices = Array.from({ length: pdfDoc.getPageCount() }, (_, i) => i);
        indicesToRemove = allIndices.filter(i => !selectedPages.has(i));
      }

      // Sort indices in descending order to avoid index shifting issues
      indicesToRemove.sort((a: number, b: number) => b - a);
      
      indicesToRemove.forEach((index: number) => {
        pdfDoc.removePage(index);
      });

      const pdfBytes = await pdfDoc.save();
      const newBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      const newFile = new File([newBlob], file.name, { type: 'application/pdf' });
      
      setFile(newFile);
      setSelectedPages(new Set());
      setLastSelectedIndex(null);
      await loadPdfProxy(pdfBytes);
    } catch (err) {
      console.error('Error processing PDF:', err);
      setError('Failed to process PDF.');
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
                      key={index} // Resetting key triggers unmount but we want stable states if possible
                      index={index}
                      pdfProxy={pdfProxy}
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
