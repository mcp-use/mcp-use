/**
 * SafeAreaInsetsEditor
 *
 * Component for editing safe area insets (top, right, bottom, left)
 * Used in MCP Apps debug controls to configure device safe areas
 */

import { Input } from "../../ui/input";

interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface SafeAreaInsetsEditorProps {
  value: SafeAreaInsets;
  onChange: (insets: SafeAreaInsets) => void;
}

export function SafeAreaInsetsEditor({
  value,
  onChange,
}: SafeAreaInsetsEditorProps) {
  const handleChange = (field: keyof SafeAreaInsets, newValue: string) => {
    const numValue = parseInt(newValue, 10);
    if (isNaN(numValue)) return;

    onChange({
      ...value,
      [field]: numValue,
    });
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Top</label>
        <Input
          type="number"
          min="0"
          value={value.top}
          onChange={(e) => handleChange("top", e.target.value)}
          className="h-8"
          data-testid="debugger-safe-area-top"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Right</label>
        <Input
          type="number"
          min="0"
          value={value.right}
          onChange={(e) => handleChange("right", e.target.value)}
          className="h-8"
          data-testid="debugger-safe-area-right"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Bottom</label>
        <Input
          type="number"
          min="0"
          value={value.bottom}
          onChange={(e) => handleChange("bottom", e.target.value)}
          className="h-8"
          data-testid="debugger-safe-area-bottom"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Left</label>
        <Input
          type="number"
          min="0"
          value={value.left}
          onChange={(e) => handleChange("left", e.target.value)}
          className="h-8"
          data-testid="debugger-safe-area-left"
        />
      </div>
    </div>
  );
}
