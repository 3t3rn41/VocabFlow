import { Grade, GRADE_LABELS } from '@/types';
import { clsx } from 'clsx';

interface GradeButtonsProps {
  layout: '3key' | '4key';
  onGrade: (g: Grade) => void;
  disabled: boolean;
}

const GRADES_3 = [Grade.Again, Grade.Hard, Grade.Good];
const GRADES_4 = [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy];

const COLORS: Record<Grade, string> = {
  [Grade.Again]: 'bg-red-500 hover:bg-red-600 text-white',
  [Grade.Hard]: 'bg-orange-500 hover:bg-orange-600 text-white',
  [Grade.Good]: 'bg-green-500 hover:bg-green-600 text-white',
  [Grade.Easy]: 'bg-blue-500 hover:bg-blue-600 text-white',
};

export function GradeButtons({ layout, onGrade, disabled }: GradeButtonsProps) {
  const grades = layout === '3key' ? GRADES_3 : GRADES_4;
  return (
    <div className="grid gap-2 md:gap-3" style={{ gridTemplateColumns: `repeat(${grades.length}, 1fr)` }}>
      {grades.map((g) => {
        const info = GRADE_LABELS[g];
        return (
          <button
            key={g}
            disabled={disabled}
            onClick={() => onGrade(g)}
            className={clsx(
              'rounded-xl py-3 md:py-4 px-2 md:px-3 transition active:scale-95 disabled:opacity-50',
              COLORS[g],
            )}
          >
            <div className="text-base md:text-lg font-bold">{info.label}</div>
            <div className="text-xs opacity-80 mt-0.5 hidden md:block">{info.hint}</div>
            <div className="text-xs opacity-60 mt-1 hidden md:block">按 {info.key}</div>
          </button>
        );
      })}
    </div>
  );
}
