'use client';

import dynamic from 'next/dynamic';

// three.js / WebGL: client only
const GalaxyView = dynamic(() => import('@/components/galaxy/galaxy-view').then((m) => m.GalaxyView), { ssr: false });

export default function GalaxyPage() {
  return (
    <div className="h-[calc(100svh-101px)] w-full">
      <GalaxyView />
    </div>
  );
}
