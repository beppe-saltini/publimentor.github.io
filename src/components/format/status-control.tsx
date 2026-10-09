"use client";

/**
 * Segmented Pass / Fail / Review / N/A control used on every checklist row.
 * Implemented as a radiogroup with roving focus so it is keyboard-usable:
 * arrow keys move between options, Space/Enter select the focused one.
 */

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { EDITABLE_STATUSES, STATUS_LABELS, type CheckStatus } from "./types";

export interface StatusControlProps {
  value: CheckStatus;
  onChange: (status: CheckStatus) => void;
  /** Accessible name for the whole group, e.g. "Status for: Is the file a PDF?" */
  label: string;
  disabled?: boolean;
}

const SELECTED_CLASSES: Record<CheckStatus, string> = {
  pass: "bg-green-600 text-white border-green-600",
  fail: "bg-red-600 text-white border-red-600",
  review: "bg-amber-500 text-white border-amber-500",
  not_applicable: "bg-gray-500 text-white border-gray-500",
  unknown: "bg-gray-300 text-gray-800 border-gray-300",
};

export function StatusControl({ value, onChange, label, disabled }: StatusControlProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusIndex = (index: number) => {
    const count = EDITABLE_STATUSES.length;
    const wrapped = (index + count) % count;
    buttonRefs.current[wrapped]?.focus();
    onChange(EDITABLE_STATUSES[wrapped]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusIndex(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusIndex(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusIndex(0);
        break;
      case "End":
        event.preventDefault();
        focusIndex(EDITABLE_STATUSES.length - 1);
        break;
      default:
        break;
    }
  };

  // When nothing editable is selected (status "unknown"), the first option is
  // tabbable so the group remains reachable by keyboard.
  const selectedIndex = EDITABLE_STATUSES.indexOf(value);

  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-gray-200 bg-white text-xs shadow-xs">
      {EDITABLE_STATUSES.map((status, index) => {
        const selected = status === value;
        const tabbable = selected || (selectedIndex === -1 && index === 0);
        return (
          <button
            key={status}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={STATUS_LABELS[status]}
            tabIndex={tabbable ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(status)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "px-2.5 py-1 font-medium border-r last:border-r-0 border-gray-200 transition-colors first:rounded-l-md last:rounded-r-md",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:z-10",
              selected ? SELECTED_CLASSES[status] : "text-gray-600 hover:bg-gray-50",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {STATUS_LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}
