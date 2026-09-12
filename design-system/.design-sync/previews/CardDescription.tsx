import React from "react";
import { Card, CardTitle, CardDescription } from "checklist-kitchen-ds";

export function Default() {
    return (
        <Card variant="list-item">
            <div>
                <CardTitle>SC3 - Cooking, Cooling &amp; Reheating</CardTitle>
                <CardDescription>Temperature checks for cooking, cooling, and reheating food</CardDescription>
            </div>
        </Card>
    );
}
