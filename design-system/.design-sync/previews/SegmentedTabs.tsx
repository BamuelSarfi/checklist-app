import React, { useState } from "react";
import { SegmentedTabs } from "checklist-kitchen-ds";

const SC3_SECTIONS = [
    { value: "cooking", label: "Cooking" },
    { value: "cooling", label: "Cooling" },
    { value: "reheating", label: "Reheating" },
];

export function Default() {
    const [value, setValue] = useState("cooking");
    return <SegmentedTabs options={SC3_SECTIONS} value={value} onChange={setValue} aria-label="Checklist section" />;
}

export function CoolingSelected() {
    const [value, setValue] = useState("cooling");
    return <SegmentedTabs options={SC3_SECTIONS} value={value} onChange={setValue} aria-label="Checklist section" />;
}
