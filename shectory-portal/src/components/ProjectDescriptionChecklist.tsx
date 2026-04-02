type Meta = {
  stack?: string[];
  servers?: unknown[];
  modules?: unknown[];
} | null;

export function ProjectDescriptionChecklist({
  description,
  uiUrl,
  meta,
}: {
  description: string | null;
  uiUrl: string | null;
  meta: Meta;
}) {
  const descOk = Boolean(description && description.trim().length >= 40);
  const uiOk = Boolean(uiUrl && uiUrl.trim().length > 0);
  const stackOk = Array.isArray(meta?.stack) && meta!.stack!.length > 0;
  const hostsOk = Array.isArray(meta?.servers) && meta!.servers!.length > 0;
  const modulesOk = Array.isArray(meta?.modules) && meta!.modules!.length > 0;

  const row = (ok: boolean, text: string) => (
    <li className={ok ? "text-emerald-300/90" : "text-amber-200/90"}>
      {ok ? "✓ " : "○ "}
      {text}
    </li>
  );

  return (
    <div className="rounded-lg border border-dashed border-slate-600/80 bg-slate-950/40 p-3 text-xs text-slate-400">
      <div className="font-medium text-slate-300">Соответствие карточки требованиям</div>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">
        Описание под названием: назначение, модули, стек, хосты, URL главного UI. Архитектура справа: потоки данных,
        протоколы, пользователи на узлах (Mermaid).
      </p>
      <ul className="mt-2 list-none space-y-1">{row(descOk, "Краткое описание (рекомендуется не менее 40 символов)")}</ul>
      <ul className="mt-1 list-none space-y-1">{row(uiOk, "Главный UI (поле uiUrl)")}</ul>
      <ul className="mt-1 list-none space-y-1">{row(stackOk, "Стек в метаданных (registryMetaJson.stack)")}</ul>
      <ul className="mt-1 list-none space-y-1">{row(hostsOk, "Хосты / площадки (registryMetaJson.servers)")}</ul>
      <ul className="mt-1 list-none space-y-1">{row(modulesOk, "Модули (registryMetaJson.modules)")}</ul>
    </div>
  );
}
