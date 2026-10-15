// Every `modules/<id>/mock.ts` (dev/mockTypes.ts), in directory order. Only dev/ imports this.
import type { ModuleMock } from "./mockTypes";

const found = import.meta.glob<{ mock: ModuleMock }>("../modules/*/mock.ts", { eager: true });

export const MODULE_MOCKS: readonly { id: string; mock: ModuleMock }[] = Object.entries(found).map(([file, m]) => ({ id: file.split("/")[2]!, mock: m.mock }));
