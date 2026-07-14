import { Button } from '@/components/ui/Button';

interface ReviewCompleteProps {
  total: number;
  onBack: () => void;
}

export function ReviewComplete({ total, onBack }: ReviewCompleteProps) {
  return (
    <div className="card-container p-6 md:p-8 max-w-md mx-auto text-center space-y-4 md:space-y-6">
      <div className="text-5xl md:text-6xl">🎉</div>
      <h2 className="text-xl md:text-2xl font-bold">今日复习完成</h2>
      <p className="text-slate-500">共学习 {total} 个单词</p>
      <Button variant="primary" size="lg" onClick={onBack} className="w-full">
        返回今日
      </Button>
    </div>
  );
}
