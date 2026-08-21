'use client';

import { Suspense } from 'react';
import { ShapeEditorProvider } from './ShapeEditorContext';
import { ShapeEditorShell } from './_components/ShapeEditorShell';

export default function ShapeEditorMapClient({
  projectName,
  defaultCenter,
}: {
  projectName: string;
  defaultCenter?: { lon: number; lat: number } | null;
}) {
  return (
    <ShapeEditorProvider>
      <Suspense fallback={<div className="h-screen w-full bg-muted/40" aria-busy="true" />}>
        <ShapeEditorShell projectName={projectName} defaultCenter={defaultCenter} />
      </Suspense>
    </ShapeEditorProvider>
  );
}
