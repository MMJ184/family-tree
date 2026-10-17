import { Button } from '@family-tree/ui';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface YearSliderProps {
  min: number;
  max: number;
  /** null = today (everyone shown). */
  value: number | null;
  onChange: (year: number | null) => void;
}

/**
 * The 4D time slider. A native range input follows the document direction, so
 * in Arabic the earliest year is on the right (spec decision #10).
 */
export function YearSlider({ min, max, value, onChange }: YearSliderProps) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const year = value ?? max;
  const yearRef = useRef(year);
  yearRef.current = year;

  useEffect(() => {
    if (!playing) return;
    if (yearRef.current >= max) onChange(min);
    const timer = setInterval(() => {
      const next = yearRef.current + 1;
      if (next >= max) {
        onChange(null);
        setPlaying(false);
      } else onChange(next);
    }, 120);
    return () => clearInterval(timer);
  }, [playing, min, max, onChange]);

  return (
    <div className="glass flex items-center gap-3 rounded-full px-3 py-2 shadow-lg">
      <Button
        size="icon"
        variant="ghost"
        className="size-8 rounded-full"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? t('time.pause') : t('time.play')}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 rtl:-scale-x-100" />}
      </Button>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={year}
        onChange={(e) => {
          setPlaying(false);
          const y = Number(e.target.value);
          onChange(y >= max ? null : y);
        }}
        aria-label={t('time.year')}
        className="h-1.5 w-40 cursor-pointer accent-[var(--ft-primary)] sm:w-64"
      />
      <span className="ltr-isolate min-w-[3.5rem] text-center font-semibold tabular-nums">
        {value == null ? t('time.today') : year}
      </span>
      {value != null && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8 rounded-full"
          onClick={() => onChange(null)}
          aria-label={t('time.today')}
        >
          <RotateCcw className="size-4" />
        </Button>
      )}
    </div>
  );
}
