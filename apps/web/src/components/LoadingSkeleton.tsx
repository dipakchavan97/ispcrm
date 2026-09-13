'use client';

import React from 'react';

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full animate-pulse divide-y divide-slate-800">
      <div className="bg-slate-800/40 h-10 w-full rounded-t-lg" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="p-4 flex items-center justify-between gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-4 bg-slate-800/60 rounded"
              style={{ width: `${Math.floor(Math.random() * 40 + 40)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function MetricSkeleton() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 animate-pulse space-y-3">
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 bg-slate-800 rounded" />
        <div className="h-8 w-8 bg-slate-800 rounded-lg" />
      </div>
      <div className="h-7 w-32 bg-slate-800 rounded" />
      <div className="h-3 w-20 bg-slate-800/60 rounded" />
    </div>
  );
}

export function CardSkeleton({ count = 1 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-slate-900 border border-slate-800 rounded-xl p-6 animate-pulse space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="h-5 w-48 bg-slate-800 rounded" />
            <div className="h-6 w-20 bg-slate-800 rounded-full" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-full bg-slate-800/60 rounded" />
            <div className="h-4 w-3/4 bg-slate-800/40 rounded" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
            <div className="h-8 bg-slate-800/50 rounded" />
            <div className="h-8 bg-slate-800/50 rounded" />
            <div className="h-8 bg-slate-800/50 rounded" />
            <div className="h-8 bg-slate-800/50 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
