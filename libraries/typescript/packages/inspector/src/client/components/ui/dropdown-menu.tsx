"use client";

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronRightIcon, CheckIcon } from "lucide-react";

import {
  DropdownMenu as FluidDropdownMenu,
  DropdownTrigger,
  DropdownContent,
  DropdownLabel,
  DropdownSeparator,
} from "@/client/components/ui/dropdown";
import { MenuItem } from "@/client/components/ui/menu-item";
import { cn } from "@/client/lib/utils";

const DropdownMenuIndexContext = React.createContext<{
  next: () => number;
} | null>(null);

function useDropdownMenuIndex() {
  const ctx = React.useContext(DropdownMenuIndexContext);
  if (!ctx) {
    throw new Error("Dropdown menu items must be inside DropdownMenuContent");
  }
  return ctx.next();
}

function extractMenuLabel(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(extractMenuLabel).filter(Boolean).join(" ").trim();
  }
  if (React.isValidElement(children)) {
    return extractMenuLabel(
      (children.props as { children?: React.ReactNode }).children
    );
  }
  return "Menu item";
}

function DropdownMenu(
  props: React.ComponentProps<typeof FluidDropdownMenu>
) {
  return <FluidDropdownMenu data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return (
    <DropdownTrigger data-slot="dropdown-menu-trigger" {...props} />
  );
}

function DropdownMenuContent({
  className,
  align = "start",
  side = "bottom",
  sideOffset = 6,
  children,
  forceMount: _forceMount,
  ...props
}: React.ComponentProps<typeof DropdownContent> & { forceMount?: boolean }) {
  const indexRef = React.useRef(0);
  const indexApi = React.useMemo(
    () => ({
      next: () => indexRef.current++,
    }),
    []
  );

  indexRef.current = 0;

  return (
    <DropdownMenuIndexContext.Provider value={indexApi}>
      <DropdownContent
        data-slot="dropdown-menu-content"
        className={className}
        align={align}
        side={side}
        sideOffset={sideOffset}
        {...props}
      >
        {children}
      </DropdownContent>
    </DropdownMenuIndexContext.Provider>
  );
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownLabel> & { inset?: boolean }) {
  return (
    <DropdownLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(inset && "pl-8", className)}
      {...props}
    />
  );
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  render,
  children,
  onSelect,
  onClick,
  disabled,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  inset?: boolean;
  variant?: "default" | "destructive";
  render?: React.ReactElement;
  onSelect?: (event: Event) => void;
  disabled?: boolean;
}) {
  const index = useDropdownMenuIndex();
  const label = extractMenuLabel(render ?? children);

  const handleSelect = () => {
    onSelect?.(new Event("select"));
  };

  if (render && React.isValidElement(render)) {
    const child = render as React.ReactElement<{
      className?: string;
      onClick?: React.MouseEventHandler;
    }>;
    return (
      <MenuItem
        index={index}
        label={label}
        disabled={disabled}
        customContent={React.cloneElement(child, {
          className: cn(
            "relative z-10 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[13px] outline-none",
            inset && "pl-8",
            variant === "destructive" && "text-destructive",
            child.props.className,
            className
          ),
          onClick: (event: React.MouseEvent) => {
            child.props.onClick?.(event);
            onClick?.(event as React.MouseEvent<HTMLDivElement>);
            if (!event.defaultPrevented) {
              handleSelect();
            }
          },
        })}
        onSelect={handleSelect}
        {...props}
      />
    );
  }

  return (
    <MenuItem
      index={index}
      label={label}
      disabled={disabled}
      className={cn(
        inset && "pl-8",
        variant === "destructive" && "text-destructive",
        className
      )}
      customContent={
        <span className="flex w-full min-w-0 items-center gap-2 text-[13px] text-inherit">
          {children}
        </span>
      }
      onClick={onClick}
      onSelect={handleSelect}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & { inset?: boolean }) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "relative z-10 flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] outline-none select-none data-inset:pl-8 data-popup-open:bg-hover data-open:bg-hover [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuSubContent({
  align = "start",
  side = "right",
  sideOffset = 6,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("min-w-[8rem]", className)}
      align={align}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & { inset?: boolean }) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative z-10 flex h-9 cursor-default items-center gap-2 rounded-lg py-0 pr-8 pl-2 text-[13px] outline-none select-none data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & { inset?: boolean }) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative z-10 flex h-9 cursor-default items-center gap-2 rounded-lg py-0 pr-8 pl-2 text-[13px] outline-none select-none data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon className="size-4" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownSeparator>) {
  return (
    <DropdownSeparator
      data-slot="dropdown-menu-separator"
      className={className}
      {...props}
    />
  );
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
