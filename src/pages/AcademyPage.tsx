import React from 'react';
import { BookOpen } from 'lucide-react';

export default function AcademyPage() {
  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen size={24} className="text-brand-600" />
        <h1 className="text-2xl font-semibold text-slate-800">Academy</h1>
      </div>
      <p className="text-slate-500">
        Kennisbank wordt hier geladen. Content volgt in een volgende stap.
      </p>
    </div>
  );
}
