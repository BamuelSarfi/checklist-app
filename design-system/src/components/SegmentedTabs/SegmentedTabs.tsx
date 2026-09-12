import React from "react";
import "./SegmentedTabs.css";

export interface SegmentedTabsOption {
    value: string;
    label: string;
}

export interface SegmentedTabsProps {
    /** Unifies .sc3_section_btn (sc3.html) and library.html's .segment control. */
    options: SegmentedTabsOption[];
    value: string;
    onChange: (value: string) => void;
    "aria-label"?: string;
}

export function SegmentedTabs({ options, value, onChange, ...rest }: SegmentedTabsProps) {
    return (
        <div className="ds-segmented-tabs" role="tablist" {...rest}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    role="tab"
                    aria-selected={opt.value === value}
                    className={`ds-segmented-tab${opt.value === value ? " active" : ""}`}
                    onClick={() => onChange(opt.value)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}
