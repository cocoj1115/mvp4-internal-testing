"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { StimulusAsset as StimulusAssetType } from "@/lib/aig/types";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

function parseTableMarkdown(md: string): { headers: string[]; rows: string[][] } {
  const lines = md.trim().split("\n").filter((l) => l.trim());
  const headers = lines[0]
    ?.split("|")
    .map((h) => h.trim())
    .filter(Boolean) ?? [];
  const rows = lines
    .slice(2)
    .map((l) =>
      l
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
    )
    .filter((r) => r.length > 0);
  return { headers, rows };
}

function TableAsset({ markdown, caption }: { markdown: string; caption: string }) {
  const { headers, rows } = parseTableMarkdown(markdown);
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    border: "1px solid #d1d5db",
                    padding: "6px 12px",
                    background: "#f8fafc",
                    fontWeight: 600,
                    textAlign: "left",
                    color: "#374151",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f9fafb" }}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      border: "1px solid #e2e8f0",
                      padding: "6px 12px",
                      color: "#111827",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && <Caption text={caption} />}
    </div>
  );
}

function ChartAsset({
  asset,
  type,
  caption,
}: {
  asset: NonNullable<StimulusAssetType["chart_data"]>;
  type: "line_graph" | "bar_chart";
  caption: string;
}) {
  const data = asset.series[0]?.points.map(([x], i) => {
    const point: Record<string, number | string> = { x: String(x) };
    for (const s of asset.series) {
      point[s.name] = s.points[i]?.[1] ?? 0;
    }
    return point;
  }) ?? [];

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        {type === "bar_chart" ? (
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="x" label={{ value: asset.x_label, position: "insideBottom", offset: -4, fontSize: 11 }} tick={{ fontSize: 11 }} />
            <YAxis label={{ value: asset.y_label, angle: -90, position: "insideLeft", fontSize: 11 }} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {asset.series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="x" label={{ value: asset.x_label, position: "insideBottom", offset: -4, fontSize: 11 }} tick={{ fontSize: 11 }} />
            <YAxis label={{ value: asset.y_label, angle: -90, position: "insideLeft", fontSize: 11 }} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {asset.series.map((s, i) => (
              <Line key={s.name} type="monotone" dataKey={s.name} stroke={COLORS[i % COLORS.length]} dot={false} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
      {caption && <Caption text={caption} />}
    </div>
  );
}

function DiagramAsset({ spec, caption }: { spec: string; caption: string }) {
  return (
    <div>
      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: 14,
          fontSize: 13,
          color: "#374151",
          whiteSpace: "pre-wrap",
          fontFamily: "monospace",
        }}
      >
        {spec}
      </div>
      {caption && <Caption text={caption} />}
    </div>
  );
}

function IllustrationAsset({
  prompt,
  caption,
}: {
  prompt: string;
  caption: string;
}) {
  const [b64, setB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/aig/illustration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json() as { b64?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Unknown error");
      } else if (data.b64) {
        setB64(data.b64);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {b64 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/png;base64,${b64}`}
          alt={caption}
          style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #e2e8f0" }}
        />
      ) : (
        <div
          style={{
            background: "#f8fafc",
            border: "1px dashed #d1d5db",
            borderRadius: 6,
            padding: 16,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
            <strong>Illustration prompt:</strong> {prompt}
          </div>
          {error && (
            <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8 }}>{error}</div>
          )}
          <button
            onClick={generate}
            disabled={loading}
            style={{
              padding: "7px 18px",
              background: loading ? "#a5b4fc" : "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 13,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Generating…" : "Generate illustration"}
          </button>
        </div>
      )}
      {caption && <Caption text={caption} />}
    </div>
  );
}

function Caption({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "#6b7280",
        marginTop: 6,
        fontStyle: "italic",
      }}
    >
      {text}
    </div>
  );
}

export function StimulusAsset({ asset }: { asset: StimulusAssetType }) {
  if (asset.type === "none") {
    return asset.caption ? (
      <div style={{ fontSize: 13, color: "#6b7280", fontStyle: "italic" }}>
        {asset.caption}
      </div>
    ) : null;
  }

  return (
    <div
      style={{
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 14,
        marginBottom: 4,
      }}
    >
      {asset.type === "table" && asset.table_markdown && (
        <TableAsset markdown={asset.table_markdown} caption={asset.caption} />
      )}
      {(asset.type === "line_graph" || asset.type === "bar_chart") && asset.chart_data && (
        <ChartAsset asset={asset.chart_data} type={asset.type} caption={asset.caption} />
      )}
      {asset.type === "diagram" && asset.diagram_spec && (
        <DiagramAsset spec={asset.diagram_spec} caption={asset.caption} />
      )}
      {asset.type === "illustration" && asset.illustration_prompt && (
        <IllustrationAsset prompt={asset.illustration_prompt} caption={asset.caption} />
      )}
    </div>
  );
}
