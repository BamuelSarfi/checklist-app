// Entry point for the browser/IIFE build only (window.KitchenDS). Re-exports everything
// from the pure component barrel (./index) plus React/ReactDOM themselves, since the global
// bundle embeds its own copy of React and vanilla consumers (script.js, status-badge.js) have
// no other way to reach React.createElement/ReactDOM.createRoot. The ESM build stays pointed
// at ./index directly and must NOT use this file - that one is the pure component barrel
// design-sync/other bundler-based consumers read.
export * from "./index";

import * as ReactNS from "react";
import * as ReactDOMNS from "react-dom/client";
export { ReactNS as React, ReactDOMNS as ReactDOM };
