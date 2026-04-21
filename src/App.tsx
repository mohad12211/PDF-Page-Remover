import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  Info
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PagePreview {
  index: number;
  dataUrl: string;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previews, setPreviews] = useState<PagePreview[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<'remove' | 'keep'>('remove');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generatePreviews = async (pdfData: Uint8Array) => {
    let pdf: any = null;
    try {
      const loadingTask = pdfjs.getDocument({ 
        data: pdfData,
        disableAutoFetch: true,
        disableStream: true,
      });
      pdf = await loadingTask.promise;
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not get canvas context');

      // Process in chunks to keep UI responsive and reduce memory pressure
      const CHUNK_SIZE = 5;
      const totalPages = pdf.numPages;
      
      for (let i = 1; i <= totalPages; i += CHUNK_SIZE) {
        const chunkPreviews: PagePreview[] = [];
        const end = Math.min(i + CHUNK_SIZE - 1, totalPages);
        
        for (let j = i; j <= end; j++) {
          const page = await pdf.getPage(j);
          // Lower scale for thumbnails to save memory and time
          const viewport = page.getViewport({ scale: 0.4 });
          
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({ 
            canvasContext: context, 
            viewport,
          }).promise;

          chunkPreviews.push({
            index: j - 1,
            dataUrl: canvas.toDataURL('image/jpeg', 0.7), // Use JPEG with compression
          });
          
          page.cleanup();
        }

        setPreviews(prev => [...prev, ...chunkPreviews]);
        // Small delay to allow UI to breathe
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (err) {
      console.error('Error generating previews:', err);
      setError('Failed to generate page previews.');
    } finally {
      if (pdf) {
        await pdf.destroy();
      }
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
    setPreviews([]); // Clear old previews
    setSelectedPages(new Set());
    setLastSelectedIndex(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      if (event.target?.result instanceof ArrayBuffer) {
        await generatePreviews(new Uint8Array(event.target.result));
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(uploadedFile);
  };

  const togglePageSelection = (index: number, isShiftKey: boolean) => {
    const newSelected = new Set(selectedPages);
    
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
      setLastSelectedIndex(index);
    }
    
    setSelectedPages(newSelected);
  };

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
      setPreviews([]); // Clear old previews
      setSelectedPages(new Set());
      setLastSelectedIndex(null);
      await generatePreviews(pdfBytes);
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
    setPreviews([]);
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
              <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-neutral-900">{file.name}</span>
                    <span className="text-xs text-neutral-500">{previews.length} pages total</span>
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

                <div className="flex items-center gap-2">
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
                    onClick={() => setSelectedPages(new Set(previews.map(p => p.index)))}
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

              {/* Info Banner */}
              <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-4 text-blue-800">
                <Info className="mt-0.5 shrink-0" size={18} />
                <div className="text-sm">
                  <p className="font-semibold">Pro Tip: Range Selection</p>
                  <p className="opacity-90">Click a page, then hold <kbd className="rounded bg-blue-100 px-1 font-mono text-xs font-bold">Shift</kbd> and click another page to select a range instantly.</p>
                </div>
              </div>

              {/* Grid */}
              {isProcessing && previews.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-4">
                  <Loader2 className="animate-spin text-red-600" size={40} />
                  <p className="text-neutral-500 animate-pulse">Processing PDF...</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {previews.map((preview) => {
                    const isSelected = selectedPages.has(preview.index);
                    return (
                      <motion.div
                        layout
                        key={preview.index}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        whileHover={{ y: -4 }}
                        onClick={(e) => togglePageSelection(preview.index, e.shiftKey)}
                        className={cn(
                          "group relative cursor-pointer overflow-hidden rounded-xl border-2 bg-white transition-all",
                          isSelected 
                            ? (actionMode === 'remove' ? "border-red-500 ring-4 ring-red-50" : "border-blue-500 ring-4 ring-blue-50")
                            : "border-neutral-200 hover:border-neutral-300"
                        )}
                      >
                        <div className="aspect-[3/4] overflow-hidden bg-neutral-100">
                          <img 
                            src={preview.dataUrl} 
                            alt={`Page ${preview.index + 1}`}
                            className="h-full w-full object-contain"
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
                            Page {preview.index + 1}
                          </span>
                          {isSelected ? (
                            <CheckSquare size={16} className={actionMode === 'remove' ? "text-red-600" : "text-blue-600"} />
                          ) : (
                            <Square size={16} className="text-neutral-300 group-hover:text-neutral-400" />
                          )}
                        </div>

                        {/* Hover Overlay for Single Remove */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/5 group-hover:opacity-100">
                          {!isSelected && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPages(new Set([preview.index]));
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
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-red-600 px-6 py-3 text-sm font-medium text-white shadow-xl">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
