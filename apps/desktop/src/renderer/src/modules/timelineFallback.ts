// Shared outside the outlet component module so Fast Refresh keeps one fallback context.
import { createContext, type ReactNode } from "react";
export const TimelineFallbackContext = createContext<ReactNode>(null);
