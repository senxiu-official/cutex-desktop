import { createContext, useContext } from "react";

export type UserLayoutToggle = (update: () => void) => void;

const direct: UserLayoutToggle = (update) => update();

/** The open conversation resets its kept bottom room after a manual expand / collapse. */
export const UserLayoutToggleContext = createContext<UserLayoutToggle>(direct);

export function useUserLayoutToggle(): UserLayoutToggle {
  return useContext(UserLayoutToggleContext);
}
