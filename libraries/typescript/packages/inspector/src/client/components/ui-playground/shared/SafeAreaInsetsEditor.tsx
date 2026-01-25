/**
 * Safe Area Insets Editor
 * Reusable component for editing safe area insets
 */

import { Input } from "@/client/components/ui/input";

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SafeAreaInsetsEditorProps {
  value: SafeAreaInsets;
  onChange: (insets: SafeAreaInsets) => void;
  className?: string;
}

export function SafeAreaInsetsEditor({
  value,
  onChange,
  className,
}: SafeAreaInsetsEditorProps) {
  const handleChange = (side: keyof SafeAreaInsets, newValue: string) => {
    onChange({
      ...value,
      [side]: parseInt(newValue) || 0,
    });
  };

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Top</label>
          <Input
            type="number"
            value={value.top}
            onChange={(e) => handleChange("top", e.target.value)}
            className="h-8"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Right</label>
          <Input
            type="number"
            value={value.right}
            onChange={(e) => handleChange("right", e.target.value)}
            className="h-8"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Bottom</label>
          <Input
            type="number"
            value={value.bottom}
            onChange={(e) => handleChange("bottom", e.target.value)}
            className="h-8"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Left</label>
          <Input
            type="number"
            value={value.left}
            onChange={(e) => handleChange("left", e.target.value)}
            className="h-8"
          />
        </div>
      </div>
    </div>
  );
}
