"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { XIcon } from "lucide-react";

// docs/07 §3 — below md every dialog is a bottom sheet (Base UI Drawer: swipe down to close,
// keyboard aware). Drawer extends Dialog, so Trigger/Title/Description/Close are shared and only
// the Root and the popup differ. From md up this is the unchanged centred dialog.

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerPrimitive.Root data-slot="dialog" {...(props as DrawerPrimitive.Root.Props)} />;
  }
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

/** Close button shared by both layouts (44px on phones). */
function DialogCloseButton() {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
    >
      <XIcon />
      <span className="sr-only">Close</span>
    </DialogPrimitive.Close>
  );
}

/** Phone layout: bottom sheet with a drag handle, a scrolling body and a sticky footer. */
function SheetContent({
  children,
  showCloseButton,
  initialFocus,
  finalFocus,
}: {
  children: React.ReactNode;
  showCloseButton: boolean;
  initialFocus?: DialogPrimitive.Popup.Props["initialFocus"];
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"];
}) {
  return (
    <DrawerPrimitive.VirtualKeyboardProvider>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 motion-reduce:transition-none" />
        <DrawerPrimitive.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
          <DrawerPrimitive.Popup
            data-slot="dialog-content"
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className="relative flex max-h-[92dvh] w-full [transform:translateY(var(--drawer-swipe-movement-y,0px))] flex-col rounded-t-2xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none data-ending-style:[transform:translateY(100%)] data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*400ms)] data-starting-style:[transform:translateY(100%)] data-swiping:select-none motion-reduce:transition-none"
          >
            <div
              aria-hidden
              className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
            />
            <DrawerPrimitive.Content className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {children}
            </DrawerPrimitive.Content>
            {showCloseButton && <DialogCloseButton />}
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.VirtualKeyboardProvider>
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    // Callers' classes size the centred dialog (max-w, max-h, overflow); the sheet sizes itself.
    return (
      <SheetContent
        showCloseButton={showCloseButton}
        initialFocus={props.initialFocus}
        finalFocus={props.finalFocus}
      >
        {children}
      </SheetContent>
    );
  }
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && <DialogCloseButton />}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Phones: sticks to the bottom of the sheet's scrolling body, above the home indicator.
        "sticky bottom-0 z-10 -mx-4 -mb-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col-reverse gap-2 rounded-b-xl border-t bg-popover p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end md:static md:z-auto md:-mb-4 md:bg-muted/50 md:pb-4",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
