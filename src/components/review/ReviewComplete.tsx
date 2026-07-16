import { Button } from '@/components/ui/Button';

interface ReviewCompleteProps {
  total: number;
  onBack: () => void;
}

export function ReviewComplete({ total, onBack }: ReviewCompleteProps) {
  return (
    <div className="card-container p-6 md:p-8 max-w-md mx-auto text-center space-y-4 md:space-y-6 animate-fadeInScale">
      <div className="text-5xl md:text-6xl animate-emptyBounce">🎉</div>
      <h2 className="text-xl md:text-2xl font-bold">今日复习完成</h2>
      <p className="text-slate-500">
        共学习 <span className="font-bold text-brand-600 animate-numberPop">{total}</span> 个单词
      </p>
      <Button variant="primary" size="lg" onClick={onBack} className="w-full pulse-glow">
        返回今日
      </Button>
    </div>
  );
}
