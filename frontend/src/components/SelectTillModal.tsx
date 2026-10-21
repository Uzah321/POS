// "Which till is this?" — only ever shown when the branch has more than one
// active register (Settings › Fiscalisation), so each device's receipts are
// fiscalised by its own till; a single-till branch never sees it. The choice
// is kept per browser (useSelectedRegister).

export default function SelectTillModal({ registers, onSelect }: { registers: any[]; onSelect: (id: number) => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="font-bold text-gray-900 mb-1">Select this till</h2>
        <p className="text-sm text-gray-500 mb-4">This branch has more than one till set up for ZIMRA fiscalisation — pick which one this device is, so receipts fiscalise correctly.</p>
        <div className="space-y-2">
          {registers.map((r: any) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              className="w-full text-left px-4 py-3 rounded-none border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors font-semibold text-gray-800"
            >
              {r.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
