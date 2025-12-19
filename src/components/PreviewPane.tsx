import React from "react";

type Props = {
  enText: string;
  heText: string;
};

export default function PreviewPane({ enText, heText }: Props) {
  return (
    <div className="grid grid-cols-1 gap-0 lg:grid-cols-2">
      <div className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
        <div className="mb-2 text-xs font-semibold text-slate-600">EN</div>
        <pre className="h-[520px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
          {enText || "Upload an .srt to see a preview here."}
        </pre>
      </div>

      <div className="p-4">
        <div className="mb-2 text-xs font-semibold text-slate-600">HE</div>
        <pre
          dir="rtl"
          className="h-[520px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-800"
        >
          {heText || "Translate to see Hebrew output here."}
        </pre>
      </div>
    </div>
  );
}
