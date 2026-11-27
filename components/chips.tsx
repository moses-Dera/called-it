"use client";
// Tappable option buttons: one choice from a short list, instead of a browser dropdown.
export function Chips<T extends string | number>({ label, value, options, onChange, disabled, light }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; disabled?: boolean; light?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map(([v, text]) => {
        const on = v === value;
        return (
          <button key={String(v)} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(v)}
            style={{ minHeight: 38, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: disabled ? "default" : "pointer",
              border: `2px solid ${light ? "#111" : on ? "var(--lime)" : "var(--line)"}`,
              background: on ? (light ? "#111" : "var(--lime)") : (light ? "#fff" : "transparent"),
              color: on ? (light ? "var(--lime)" : "#111") : (light ? "#111" : "var(--text)"), opacity: disabled && !on ? 0.5 : 1 }}>
            {text}
          </button>
        );
      })}
    </div>
  );
}
