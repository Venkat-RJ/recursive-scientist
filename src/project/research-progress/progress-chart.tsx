import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { IconButton } from "../../components/ui/icon-button";
import type { Point } from "./research-progress-model";

const WINDOW_SIZE = 8;
export type ChartWindow = { size: number; end?: number };

export function ProgressChart({ points, baseline, selected, range, changeRange, openPoint, format }: {
  points: readonly Point[];
  baseline?: Point;
  selected?: string;
  range?: ChartWindow;
  changeRange: (range?: ChartWindow) => void;
  openPoint: (point: Point) => void;
  format: (value: number) => string;
}) {
  const { t, i18n } = useLingui();
  const size = Math.min(range?.size ?? WINDOW_SIZE, points.length);
  const end = Math.min(points.length, Math.max(size, range?.end ?? points.length));
  const start = end - size;
  const visible = points.slice(start, end);
  if (!visible.length) return null;

  const values = visible.map(({ metric }) => metric.value);
  // Fit the measured window. A distant baseline is still shown in the summary.
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = max - min || Math.abs(min) * 0.08 || 1;
  const reference = baseline?.metric.value;
  const includeReference = reference !== undefined && reference >= min - width && reference <= max + width;
  const low = (includeReference ? Math.min(min, reference) : min) - width * 0.12;
  const high = (includeReference ? Math.max(max, reference) : max) + width * 0.12;
  const y = (value: number) => 100 * (high - value) / (high - low);
  const x = (index: number) => size === 1 ? 50 : 5 + 90 * index / (size - 1);
  const compact = new Intl.NumberFormat(i18n.locale, { notation: "compact", maximumSignificantDigits: 4 });
  const ticks = [max, (max + min) / 2, min].filter((value, index, all) => all.indexOf(value) === index);
  const plot = visible.map((point, index) => ({ point, x: x(index), y: y(point.metric.value) }));
  const lines = plot.flatMap((position, index) =>
    position.point.valid && plot[index - 1]?.point.valid ? [[plot[index - 1], position]] : []);
  const baselineY = includeReference ? y(reference) : undefined;
  const first = start + 1;
  const total = points.length;
  const zoom = (nextSize: number) => {
    const count = Math.min(points.length, Math.max(2, nextSize));
    const selectedIndex = visible.findIndex(({ experiment }) => experiment.id === selected);
    if (selectedIndex === -1 || (end === points.length && count >= size)) {
      changeRange({ size: count, end: range?.end });
    } else {
      const nextEnd = Math.min(points.length, Math.max(count, start + selectedIndex + Math.ceil(count / 2)));
      changeRange({ size: count, end: nextEnd === points.length ? undefined : nextEnd });
    }
  };
  return (
    <figure className="progress-chart" aria-label={t`Experiment progression`}>
      <div className="progress-plot">
        <div className="progress-plot-axis" aria-hidden="true">
          {ticks.map((value) => <span key={value} style={{ top: `${y(value)}%` }}>{compact.format(value)}</span>)}
        </div>
        <div className="progress-plot-field">
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
            {ticks.map((value) => <line className="progress-gridline" key={value} x1="0" x2="100" y1={y(value)} y2={y(value)} />)}
            {baselineY !== undefined && baselineY >= 0 && baselineY <= 100 &&
              <line className="progress-baseline-line" x1="0" x2="100" y1={baselineY} y2={baselineY} />}
            {lines.map(([a, b]) =>
              <line className="progress-score-line" key={b.point.experiment.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)}
          </svg>
          {plot.map(({ point, x: left, y: top }) => {
            const id = point.experiment.id;
            const score = format(point.metric.value);
            const status = point.valid ? t`Verified` : point.experiment.decision === "rejected" ? t`Rejected` : t`Reported`;
            const label = t`${id}, ${score}, ${status}`;
            return (
              <button key={id} type="button" className="progress-point" title={label} aria-label={label}
                aria-pressed={selected === id} data-valid={point.valid} data-rejected={point.experiment.decision === "rejected" || undefined}
                style={{ left: `${left}%`, top: `${top}%` }}
                onClick={() => openPoint(point)}
              >
                <span aria-hidden="true" />
              </button>
            );
          })}
          <div className="progress-x-labels" aria-hidden="true">
            <span>{visible[0].experiment.id}</span>
            {size > 1 && <span>{visible[size - 1].experiment.id}</span>}
          </div>
        </div>
      </div>
      <figcaption>
        <span>{t`${first}–${end} of ${total} results`}{includeReference && <> · {t`Dashed baseline`}</>}</span>
        <div className="progress-chart-actions">
          <IconButton size="compact" label={t`Earlier results`} disabled={!start}
            onClick={() => changeRange({ size, end: Math.max(size, end - Math.max(1, Math.floor(size / 2))) })}><ChevronLeft size={14} /></IconButton>
          <IconButton size="compact" label={t`Later results`} disabled={end === points.length}
            onClick={() => {
              const next = end + Math.max(1, Math.floor(size / 2));
              changeRange({ size, end: next >= points.length ? undefined : next });
            }}><ChevronRight size={14} /></IconButton>
          <IconButton size="compact" label={t`Zoom in chart`} disabled={size <= 2}
            onClick={() => zoom(Math.ceil(size / 2))}><Plus size={14} /></IconButton>
          <IconButton size="compact" label={t`Zoom out chart`} disabled={size === points.length || size >= 24}
            onClick={() => zoom(Math.min(24, size * 2))}><Minus size={14} /></IconButton>
          <Button size="compact" variant="ghost" onClick={() => changeRange()} disabled={!range}>{t`Latest`}</Button>
        </div>
      </figcaption>
    </figure>
  );
}
