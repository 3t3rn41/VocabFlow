import { describe, it, expect } from 'vitest';
import { toBJDate, daysAgoBJ, formatDuration } from '../date';

describe('date utils', () => {
  it('toBJDate returns YYYY-MM-DD in Beijing time', () => {
    // 2024-01-01T16:00:00Z = 2024-01-02 in Beijing (UTC+8)
    const r = toBJDate('2024-01-01T16:00:00Z');
    expect(r).toBe('2024-01-02');
  });

  it('daysAgoBJ returns correct past date', () => {
    const fakeNow = new Date('2024-03-15T10:00:00Z');
    const r = daysAgoBJ(7, fakeNow);
    expect(r).toBe('2024-03-08');
  });

  it('formatDuration formats correctly', () => {
    expect(formatDuration(5000)).toBe('5秒');
    expect(formatDuration(90000)).toBe('1分钟30秒');
    expect(formatDuration(3_660_000)).toBe('1小时1分钟');
  });
});
