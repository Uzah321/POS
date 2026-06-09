import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  lastPage: number;
  from?: number;
  to?: number;
  total?: number;
  onPageChange: (page: number) => void;
}

function pageNumbers(current: number, last: number): (number | '…')[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);

  const pages: (number | '…')[] = [1, 2];
  if (current > 4) pages.push('…');
  const lo = Math.max(3, current - 1);
  const hi = Math.min(last - 2, current + 1);
  for (let p = lo; p <= hi; p++) pages.push(p);
  if (current < last - 3) pages.push('…');
  pages.push(last - 1, last);
  return pages;
}

export default function Pagination({ page, lastPage, from, to, total, onPageChange }: Props) {
  if (lastPage <= 1) return null;

  const pages = pageNumbers(page, lastPage);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
      <p className="text-sm text-gray-500">
        {from != null && to != null && total != null
          ? `Showing ${from}–${to} of ${total}`
          : total != null
          ? `${total} records`
          : `Page ${page} of ${lastPage}`}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={15} />
        </button>

        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="px-1 text-gray-400 text-sm select-none">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p as number)}
              className={`min-w-[32px] h-8 rounded-lg text-sm font-medium transition-colors ${
                p === page
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          )
        )}

        <button
          type="button"
          disabled={page === lastPage}
          onClick={() => onPageChange(page + 1)}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
