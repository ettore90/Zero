import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { ModelConfig, UsageRecord } from '../types';
import { APP_BASE_PATH } from '../constants';

const LOCAL_BASE = window.location.pathname.split('/').slice(0, 2).join('/') || APP_BASE_PATH;

interface Props {
  usageHistory: UsageRecord[];
  models: ModelConfig[];
}

interface DailyRecord {
  date: string;
  modelId: string;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
}

interface SummaryRecord {
  modelId: string;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  lastUsed: number;
}

// Palette for model lines
const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function formatDate(dateStr: string) {
  const [, , d] = dateStr.split('-');
  return parseInt(d).toString();
}

function monthName(m: number) {
  return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][m - 1];
}

function fmtNum(n: number, isCost = false) {
  if (isCost) {
    if (n >= 1) return `${n.toFixed(2)}`;
    if (n >= 0.001) return `${n.toFixed(4)}`;
    return `${n.toFixed(6)}`;
  }
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

// ─── Line Chart ──────────────────────────────────────────────────────────────

interface ChartProps {
  allDays: string[];
  effectiveModels: string[];
  series: Record<string, Record<string, number>>;
  modelColor: Record<string, string>;
  modelName: Record<string, string>;
  metric: 'tokens' | 'requests' | 'cost';
}

function LineChart({ allDays, effectiveModels, series, modelColor, modelName, metric }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(700);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [tooltipX, setTooltipX] = useState(0);

  // Observe container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const daysInMonth = allDays.length;

  // Minimum px per day so labels don't overlap
  const minPxPerDay = 18;
  const padL = 52;
  const padR = 12;
  const padT = 16;
  const padB = 32;

  const innerW = Math.max(containerW - padL - padR, daysInMonth * minPxPerDay);
  const chartW = innerW + padL + padR;
  const chartH = 240;
  const innerH = chartH - padT - padB;

  // Needs horizontal scroll?
  const needsScroll = chartW > containerW;

  const maxVal = useMemo(() => {
    let max = 0;
    for (const id of effectiveModels) {
      const s = series[id] || {};
      for (const d of allDays) {
        const v = s[d] || 0;
        if (v > max) max = v;
      }
    }
    return max || 1;
  }, [series, effectiveModels, allDays]);

  function xPos(i: number) {
    return padL + (i / Math.max(daysInMonth - 1, 1)) * innerW;
  }
  function yPos(val: number) {
    return padT + innerH - (val / maxVal) * innerH;
  }

  function buildPath(modelId: string) {
    const s = series[modelId] || {};
    return allDays
      .map((d, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(s[d] || 0).toFixed(1)}`)
      .join(' ');
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    val: Math.round(maxVal * f),
    y: yPos(maxVal * f),
  }));

  // X ticks: show every day if ≤ 15 days, else every 5
  const xTicks = allDays
    .map((d, i) => ({ label: formatDate(d), x: xPos(i), i }))
    .filter(t => daysInMonth <= 15 || t.i === 0 || (t.i + 1) % 5 === 0 || t.i === daysInMonth - 1);

  // Tooltip data for hovered day
  const tooltipData = useMemo(() => {
    if (!hoveredDay) return null;
    const rows = effectiveModels
      .map(id => ({ id, val: (series[id] || {})[hoveredDay] || 0 }))
      .filter(r => r.val > 0)
      .sort((a, b) => b.val - a.val);
    return rows;
  }, [hoveredDay, effectiveModels, series]);

  // Hover band: find nearest day from mouse X
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    // Find nearest day index
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < daysInMonth; i++) {
      const dist = Math.abs(xPos(i) - mx);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    if (bestDist < 30) {
      setHoveredDay(allDays[best]);
      setTooltipX(xPos(best));
    } else {
      setHoveredDay(null);
    }
  }

  const hasData = effectiveModels.some(id => series[id] && Object.values(series[id]).some(v => v > 0));

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {!hasData ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569', fontSize: 14 }}>
          Sem dados para o período selecionado
        </div>
      ) : (
        <div style={{ overflowX: needsScroll ? 'auto' : 'visible', position: 'relative' }}>
          <svg
            width={chartW}
            height={chartH}
            style={{ display: 'block', minWidth: chartW }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredDay(null)}
          >
            {/* Grid lines */}
            {yTicks.map(t => (
              <g key={t.val}>
                <line x1={padL} y1={t.y} x2={chartW - padR} y2={t.y}
                  stroke="#334155" strokeWidth={0.5} strokeDasharray="4 4" />
                <text x={padL - 6} y={t.y + 4} textAnchor="end" fontSize={10} fill="#475569">
                  {fmtNum(t.val, metric === 'cost')}
                </text>
              </g>
            ))}

            {/* X axis ticks */}
            {xTicks.map(t => (
              <g key={t.i}>
                <line x1={t.x} y1={padT + innerH} x2={t.x} y2={padT + innerH + 4}
                  stroke="#475569" strokeWidth={1} />
                <text x={t.x} y={padT + innerH + 16} textAnchor="middle" fontSize={10} fill="#475569">
                  {t.label}
                </text>
              </g>
            ))}

            {/* Axes */}
            <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="#475569" strokeWidth={1} />
            <line x1={padL} y1={padT + innerH} x2={chartW - padR} y2={padT + innerH} stroke="#475569" strokeWidth={1} />

            {/* Hover band */}
            {hoveredDay && (() => {
              const i = allDays.indexOf(hoveredDay);
              const x = xPos(i);
              return (
                <line x1={x} y1={padT} x2={x} y2={padT + innerH}
                  stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
              );
            })()}

            {/* Lines per model */}
            {effectiveModels.filter(id => series[id]).map(id => (
              <path
                key={id}
                d={buildPath(id)}
                fill="none"
                stroke={modelColor[id] || '#6366f1'}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* Dots on non-zero points */}
            {effectiveModels.filter(id => series[id]).map(id =>
              allDays.map((d, i) => {
                const val = (series[id] || {})[d] || 0;
                if (val === 0) return null;
                return (
                  <circle
                    key={`${id}-${d}`}
                    cx={xPos(i)} cy={yPos(val)} r={hoveredDay === d ? 5 : 3}
                    fill={modelColor[id] || '#6366f1'}
                    style={{ transition: 'r 0.1s' }}
                  />
                );
              })
            )}
          </svg>

          {/* Tooltip */}
          {hoveredDay && tooltipData && tooltipData.length > 0 && (
            <div style={{
              position: 'absolute',
              top: padT,
              left: Math.min(tooltipX + 12, chartW - 180),
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              color: '#e2e8f0',
              pointerEvents: 'none',
              zIndex: 10,
              minWidth: 160,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#94a3b8', fontSize: 11 }}>
                {hoveredDay} — {metric === 'tokens' ? 'Tokens' : metric === 'requests' ? 'Requests' : 'Custo (USD)'}
              </div>
              {tooltipData.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: modelColor[r.id] || '#6366f1', flexShrink: 0,
                  }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#94a3b8' }}>
                    {modelName[r.id] || r.id}
                  </span>
                  <span style={{ fontWeight: 600, color: '#f1f5f9' }}>
                    {metric === 'cost' ? fmtNum(r.val, true) : r.val.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      {hasData && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginTop: 12 }}>
          {effectiveModels.filter(id => series[id]).map(id => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
              <span style={{
                display: 'inline-block', width: 24, height: 3, borderRadius: 2,
                background: modelColor[id] || '#6366f1',
              }} />
              {modelName[id] || id}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ModelDashboard({ usageHistory: _usageHistory, models }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  // null = all selected; string[] = explicit selection
  const [selectedModels, setSelectedModels] = useState<string[] | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dailyData, setDailyData] = useState<DailyRecord[]>([]);
  const [summaryData, setSummaryData] = useState<SummaryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<'tokens' | 'requests' | 'cost'>('tokens');
  const [sessions, setSessions] = useState<{ session_id: string; agent_id: string; title: string; requests: number; tokens: number; firstSeen: number; lastSeen: number }[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // All model IDs seen in data
  const allModelIds = useMemo(() => {
    const ids = new Set<string>();
    dailyData.forEach(r => ids.add(r.modelId));
    summaryData.forEach(r => ids.add(r.modelId));
    models.forEach(m => { if (m.id) ids.add(m.id); });
    return [...ids].filter(Boolean);
  }, [dailyData, summaryData, models]);

  // When allModelIds changes, add new IDs to explicit selection (if not null)
  useEffect(() => {
    if (allModelIds.length === 0) return;
    setSelectedModels(prev => {
      if (prev === null) return null; // "all" stays "all"
      const next = [...prev];
      for (const id of allModelIds) {
        if (!next.includes(id)) next.push(id);
      }
      return next.length === prev.length ? prev : next;
    });
  }, [allModelIds]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dailyRes, summaryRes, sessionsRes] = await Promise.all([
        fetch(`${LOCAL_BASE}/api/usage/daily?year=${year}&month=${month}${selectedSession ? `&sessionId=${encodeURIComponent(selectedSession)}` : ''}`),
        fetch(`${LOCAL_BASE}/api/usage/summary`),
        fetch(`${LOCAL_BASE}/api/usage/sessions`),
      ]);
      if (!dailyRes.ok || !summaryRes.ok) throw new Error('Erro ao buscar dados');
      const daily = await dailyRes.json();
      const summary = await summaryRes.json();
      setDailyData(daily.records || []);
      setSummaryData(summary.models || []);
      if (sessionsRes.ok) {
        const sData = await sessionsRes.json();
        setSessions(Array.isArray(sData.sessions) ? sData.sessions : []);
      }
    } catch (e: any) {
      setError(e.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }, [year, month, selectedSession]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const effectiveModels = selectedModels === null ? allModelIds : selectedModels;

  const filteredDaily = useMemo(() =>
    dailyData.filter(r => effectiveModels.includes(r.modelId)),
    [dailyData, effectiveModels]
  );

  const filteredSummary = useMemo(() =>
    summaryData.filter(r => effectiveModels.includes(r.modelId)),
    [summaryData, effectiveModels]
  );

  // Build a lookup: modelId (model name/slug) -> ModelConfig
  const modelConfigMap = useMemo(() => {
    const map: Record<string, ModelConfig> = {};
    models.forEach(m => {
      // Index by modelId (the actual model name used in usage records)
      if (m.modelId) map[m.modelId] = m;
      // Also index by id as fallback
      if (m.id) map[m.id] = m;
    });
    return map;
  }, [models]);

  // Estimate cost for a summary record using model pricing
  function estimateCost(r: SummaryRecord): number {
    const cfg = modelConfigMap[r.modelId];
    if (!cfg) return 0;
    if (cfg.inputCostPerMToken != null && cfg.outputCostPerMToken != null) {
      return (r.promptTokens / 1_000_000) * cfg.inputCostPerMToken
           + (r.completionTokens / 1_000_000) * cfg.outputCostPerMToken;
    }
    if (cfg.costPerMToken != null) {
      return (r.tokens / 1_000_000) * cfg.costPerMToken;
    }
    return 0;
  }

  // Estimate cost for a daily record using model pricing
  function estimateDailyCost(modelId: string, tokens: number, promptTokens: number, completionTokens: number): number {
    const cfg = modelConfigMap[modelId];
    if (!cfg) return 0;
    if (cfg.inputCostPerMToken != null && cfg.outputCostPerMToken != null) {
      return (promptTokens / 1_000_000) * cfg.inputCostPerMToken
           + (completionTokens / 1_000_000) * cfg.outputCostPerMToken;
    }
    if (cfg.costPerMToken != null) {
      return (tokens / 1_000_000) * cfg.costPerMToken;
    }
    return 0;
  }

  const totals = useMemo(() => {
    const cost = filteredSummary.reduce((s, r) => s + estimateCost(r), 0);
    return {
      requests: filteredSummary.reduce((s, r) => s + r.requests, 0),
      tokens: filteredSummary.reduce((s, r) => s + r.tokens, 0),
      promptTokens: filteredSummary.reduce((s, r) => s + r.promptTokens, 0),
      completionTokens: filteredSummary.reduce((s, r) => s + r.completionTokens, 0),
      cost,
    };
  }, [filteredSummary, modelConfigMap]);

  const daysInMonth = getDaysInMonth(year, month);
  const allDays = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });

  const modelColor = useMemo(() => {
    const map: Record<string, string> = {};
    allModelIds.forEach((id, i) => { map[id] = COLORS[i % COLORS.length]; });
    return map;
  }, [allModelIds]);

  const modelName = useMemo(() => {
    const map: Record<string, string> = {};
    models.forEach(m => { if (m.id) map[m.id] = m.name || m.id; });
    return map;
  }, [models]);

  // Build series for tokens
  const tokenSeries = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const r of filteredDaily) {
      if (!map[r.modelId]) map[r.modelId] = {};
      map[r.modelId][r.date] = (map[r.modelId][r.date] || 0) + r.tokens;
    }
    return map;
  }, [filteredDaily]);

  // Build series for requests
  const requestSeries = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const r of filteredDaily) {
      if (!map[r.modelId]) map[r.modelId] = {};
      map[r.modelId][r.date] = (map[r.modelId][r.date] || 0) + r.requests;
    }
    return map;
  }, [filteredDaily]);

  // Build series for cost (USD)
  const costSeries = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const r of filteredDaily) {
      if (!map[r.modelId]) map[r.modelId] = {};
      const c = estimateDailyCost(r.modelId, r.tokens, r.promptTokens ?? 0, r.completionTokens ?? 0);
      map[r.modelId][r.date] = (map[r.modelId][r.date] || 0) + c;
    }
    return map;
  }, [filteredDaily, modelConfigMap]);

  const activeSeries = metric === 'tokens' ? tokenSeries : metric === 'requests' ? requestSeries : costSeries;

  function toggleModel(id: string) {
    setSelectedModels(prev => {
      const base = prev === null ? [...allModelIds] : [...prev];
      if (base.includes(id)) {
        const next = base.filter(x => x !== id);
        // If nothing left, keep at least empty array (no models shown)
        return next;
      }
      const next = [...base, id];
      // If all models are now selected, go back to null (all)
      return next.length === allModelIds.length ? null : next;
    });
  }

  function toggleAll() {
    // If all selected (null or full array), deselect all; otherwise select all
    const allSelected = selectedModels === null || selectedModels.length === allModelIds.length;
    setSelectedModels(allSelected ? [] : null);
  }

  const yearOptions = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  const selectStyle: React.CSSProperties = {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
    color: '#e2e8f0', padding: '6px 10px', fontSize: 13, cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: '#64748b', marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  };

  return (
    <div style={{
      padding: '24px',
      fontFamily: 'inherit',
      color: 'var(--text-primary, #e2e8f0)',
      height: '100%',
      overflowY: 'auto',
      boxSizing: 'border-box',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>📊 Model Dashboard</h2>
        <button
          onClick={fetchData}
          disabled={loading}
          style={{
            padding: '6px 16px', borderRadius: 6, border: '1px solid #334155',
            background: '#1e293b', color: '#94a3b8', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {loading ? '⏳ Carregando...' : '🔄 Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Requisições', value: totals.requests.toLocaleString() },
          { label: 'Tokens totais', value: totals.tokens.toLocaleString() },
          { label: 'Tokens prompt', value: totals.promptTokens.toLocaleString() },
          { label: 'Tokens resposta', value: totals.completionTokens.toLocaleString() },
          {
            label: 'Custo estimado',
            value: totals.cost > 0
              ? `${totals.cost.toFixed(totals.cost < 0.01 ? 4 : 2)}`
              : '—',
            highlight: totals.cost > 0,
          },
        ].map(card => (
          <div key={card.label} style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
            padding: '14px 18px',
          }}>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: (card as any).highlight ? '#34d399' : '#f1f5f9' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>

        {/* Month */}
        <div>
          <div style={labelStyle}>Mês</div>
          <select value={month} onChange={e => setMonth(parseInt(e.target.value))} style={selectStyle}>
            {monthOptions.map(m => (
              <option key={m} value={m}>{monthName(m)}</option>
            ))}
          </select>
        </div>

        {/* Year */}
        <div>
          <div style={labelStyle}>Ano</div>
          <select value={year} onChange={e => setYear(parseInt(e.target.value))} style={selectStyle}>
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Session filter */}
        {sessions.length > 0 && (
          <div>
            <div style={labelStyle}>Sessão</div>
            <select
              value={selectedSession}
              onChange={e => setSelectedSession(e.target.value)}
              style={{ ...selectStyle, maxWidth: 220 }}
            >
              <option value=''>Todas as sessões</option>
              {sessions.map(s => {
                const isGenericTitle = !s.title || s.title.trim() === '' || s.title.trim().toLowerCase() === 'new session';
                const safeDate = Number.isFinite(s.firstSeen) ? new Date(s.firstSeen).toLocaleString('pt-BR') : 'Sessão antiga';
                const label = isGenericTitle
                  ? `${safeDate} — ${s.requests} req`
                  : `${s.title} — ${s.requests} req`;

                return (
                  <option key={s.session_id} value={s.session_id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Model multi-select */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <div style={labelStyle}>Modelos</div>
          <button
            onClick={() => setDropdownOpen(o => !o)}
            style={{
              background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
              color: '#e2e8f0', padding: '6px 12px', fontSize: 13, cursor: 'pointer',
              minWidth: 180, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
            }}
          >
            <span>
              {effectiveModels.length === allModelIds.length
                ? 'Todos os modelos'
                : effectiveModels.length === 0
                  ? 'Nenhum selecionado'
                  : `${effectiveModels.length} modelo${effectiveModels.length > 1 ? 's' : ''}`}
            </span>
            <span style={{ fontSize: 10, color: '#64748b' }}>{dropdownOpen ? '▲' : '▼'}</span>
          </button>

          {dropdownOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 100,
              background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
              minWidth: 220, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              maxHeight: 280, overflowY: 'auto',
            }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                cursor: 'pointer', borderBottom: '1px solid #334155',
                fontSize: 13, color: '#94a3b8',
              }}>
                <input
                  type="checkbox"
                  checked={effectiveModels.length === allModelIds.length}
                  onChange={toggleAll}
                  style={{ accentColor: '#6366f1', width: 14, height: 14 }}
                />
                Selecionar todos
              </label>

              {allModelIds.map(id => (
                <label key={id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                  cursor: 'pointer', fontSize: 13, color: '#e2e8f0',
                  borderBottom: '1px solid #1e293b',
                }}>
                  <input
                    type="checkbox"
                    checked={effectiveModels.includes(id)}
                    onChange={() => toggleModel(id)}
                    style={{ accentColor: modelColor[id] || '#6366f1', width: 14, height: 14 }}
                  />
                  <span style={{
                    display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                    background: modelColor[id] || '#6366f1', flexShrink: 0,
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {modelName[id] || id}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Metric toggle */}
        <div>
          <div style={labelStyle}>Métrica</div>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #334155' }}>
            {(['tokens', 'requests', 'cost'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                style={{
                  padding: '6px 14px', fontSize: 13, cursor: 'pointer', border: 'none',
                  background: metric === m ? '#6366f1' : '#1e293b',
                  color: metric === m ? '#fff' : '#94a3b8',
                  fontWeight: metric === m ? 600 : 400,
                  transition: 'background 0.15s',
                }}
              >
                {m === 'tokens' ? 'Tokens' : m === 'requests' ? 'Requests' : 'Custo'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Line Chart */}
      <div style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
        padding: '20px 16px 12px', marginBottom: 24,
      }}>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
          {metric === 'tokens' ? 'Tokens' : metric === 'requests' ? 'Requests' : 'Custo estimado (USD)'} por dia — {monthName(month)} {year}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569', fontSize: 14 }}>
            Carregando dados...
          </div>
        ) : (
          <LineChart
            allDays={allDays}
            effectiveModels={effectiveModels}
            series={activeSeries}
            modelColor={modelColor}
            modelName={modelName}
            metric={metric}
          />
        )}
      </div>

      {/* Per-model table */}
      {filteredSummary.length > 0 && (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #334155', fontSize: 13, color: '#64748b' }}>
            Totais por modelo (histórico completo, filtrado)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#0f172a' }}>
                {['Modelo', 'Requisições', 'Tokens totais', 'Prompt', 'Resposta', 'Custo est.'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: h === 'Modelo' ? 'left' : 'right', color: '#64748b', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSummary.map((r, i) => (
                <tr key={r.modelId} style={{ borderTop: '1px solid #334155', background: i % 2 === 0 ? 'transparent' : '#0f172a22' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                        background: modelColor[r.modelId] || '#6366f1', flexShrink: 0,
                      }} />
                      <span style={{ color: '#e2e8f0' }}>{modelName[r.modelId] || r.modelId}</span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8' }}>{r.requests.toLocaleString()}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8' }}>{r.tokens.toLocaleString()}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8' }}>{r.promptTokens.toLocaleString()}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8' }}>{r.completionTokens.toLocaleString()}</td>
                  {(() => {
                    const cost = estimateCost(r);
                    return (
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: cost > 0 ? '#34d399' : '#475569', fontWeight: cost > 0 ? 600 : 400 }}>
                        {cost > 0 ? `${cost.toFixed(cost < 0.01 ? 4 : 2)}` : '—'}
                      </td>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
