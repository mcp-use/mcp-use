"use client";

import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useTheme } from "@/client/context/ThemeContext";
import { cn } from "@/client/lib/utils";
import { Monitor, Moon, SunDim } from "lucide-react";
import { useRef } from "react";
import { flushSync } from "react-dom";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const getThemeIcon = () => {
    if (theme === "system") return <Monitor className="size-4" />;
    if (theme === "light") return <SunDim className="size-4" />;
    return <Moon className="size-4" />;
  };

  const handleThemeChange = async (newTheme: "light" | "dark" | "system") => {
    const buttonElement = buttonRef.current;
    if (!buttonElement) {
      setTheme(newTheme);
      return;
    }

    // Check if view transitions are supported
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      await document.startViewTransition(() => {
        flushSync(() => {
          setTheme(newTheme);
        });
      }).ready;

      const { top, left, width, height } =
        buttonElement.getBoundingClientRect();
      const y = top + height / 2;
      const x = left + width / 2;

      const right = window.innerWidth - left;
      const bottom = window.innerHeight - top;
      const maxRad = Math.hypot(Math.max(left, right), Math.max(top, bottom));

      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${maxRad}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 700,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    } else {
      // Fallback for browsers that don't support view transitions
      setTheme(newTheme);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={buttonRef}
          variant="ghost"
          size="sm"
          className={cn(
            "p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors",
            className
          )}
          aria-label="Toggle theme"
        >
          {getThemeIcon()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-0">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) =>
            handleThemeChange(value as "light" | "dark" | "system")
          }
        >
          <DropdownMenuRadioItem
            value="light"
            className="pl-2 pr-0 flex items-center gap-2 justify-end"
          >
            <span>Light</span>
            <SunDim className="mr-2 h-4 w-4" />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="dark"
            className="pl-2 pr-0 flex items-center gap-2 justify-end"
          >
            <span>Dark</span>
            <Moon className="mr-2 h-4 w-4" />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="system"
            className="pl-2 pr-0 flex items-center gap-2 justify-end"
          >
            <span>System</span>
            <Monitor className="mr-2 h-4 w-4" />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
