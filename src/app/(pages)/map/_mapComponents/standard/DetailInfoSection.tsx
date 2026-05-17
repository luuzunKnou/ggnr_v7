'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InfoField {
  label: string;
  value: string | number;
  unit?: string;
  highlight?: boolean;
}

export function InfoSection({
  title,
  fields,
  defaultOpen = true,
}: {
  title: string;
  fields: InfoField[];
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-primary" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-500" />
        )}
        <span className="text-[13px] font-semibold text-slate-900">{title}</span>
      </button>
      {isOpen && (
        <div className="px-4 pb-3">
          <div className="overflow-hidden rounded border border-slate-200">
            {fields.map((field, index) => (
              <div
                key={`${field.label}-${index}`}
                className={cn(
                  'flex items-stretch',
                  index !== fields.length - 1 && 'border-b border-slate-200'
                )}
              >
                <div className="flex min-w-0 w-[120px] shrink-0 items-start bg-slate-100 px-3 py-2">
                  <span className="min-w-0 w-full whitespace-normal break-words text-xs leading-snug text-slate-500">
                    {field.label}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 items-start px-3 py-2">
                  <span
                    className={cn(
                      'text-xs',
                      field.highlight ? 'font-medium text-primary' : 'text-slate-900'
                    )}
                  >
                    {field.value}
                    {field.unit != null && field.unit !== '' && (
                      <span className="ml-0.5 text-slate-500">{field.unit}</span>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
