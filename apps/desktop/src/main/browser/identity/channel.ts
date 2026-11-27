// 浏览器身份 IPC (package 0): the app's main frame only; every request is parsed strictly, then routed to the
// service of its package. An op whose service is not installed answers `unsupported_operation` (the renderer
// hides that part). Not reachable by pages, plugins, opaque frames or agents.
import { parseBrowserIdentityRequest, type BrowserIdentityRequest } from "../../../shared/browserIdentity";
import type { BrowserIdentityServices } from "./contract";

const unsupported = (): never => { throw new Error("unsupported_operation"); };

export function createBrowserIdentityChannel<E>(options: { isAppSender(event: E): boolean; services: BrowserIdentityServices }) {
  return async (event: E, raw: unknown): Promise<unknown> => {
    if (!options.isAppSender(event)) throw new Error("untrusted_sender");
    return route(parseBrowserIdentityRequest(raw), options.services);
  };
}

export async function route(r: BrowserIdentityRequest, s: BrowserIdentityServices): Promise<unknown> {
  const ids = () => s.identities ?? unsupported();
  const history = () => s.history ?? unsupported();
  const passwords = () => s.passwords ?? unsupported();
  const sync = () => s.sync ?? unsupported();
  switch (r.op) {
    case "state": return ids().state();
    case "create": return ids().create(r.name, r.color, r.initial);
    case "update": return ids().update(r.id, r.expectedRevision, { name: r.name, color: r.color, initial: r.initial });
    case "setCurrent": return ids().setCurrent(r.id);
    case "signOut": return ids().signOut(r.id);
    case "signOutHost": return ids().signOutHost(r.id, r.hostId);
    case "clearLeftover": return ids().clearLeftover(r.id, r.hostId);
    case "remove": return ids().remove(r.id);
    case "storage": return ids().storage(r.id);
    case "signedInSites": return ids().signedInSites(r.id, r.hostId);
    case "clearData": {
      const { types } = r.request;
      if (types.includes("history")) await history().clear(r.request);
      if (types.some((t) => t !== "history")) await ids().clearData({ ...r.request, types: types.filter((t) => t !== "history") });
      return;
    }
    case "prefs": {
      // 「验证后 5 分钟内不再问」: on needs the owner's gesture + Windows Hello; off locks at once.
      const grace = r.patch?.passwordHelloGrace;
      if (grace === true && s.passwords && !(await ids().prefs()).passwordHelloGrace) await s.passwords.confirmGrace();
      const next = await ids().prefs(r.patch);
      if (grace !== undefined) s.passwords?.graceChanged(next.passwordHelloGrace);
      return next;
    }
    case "history": return history().query(r.query);
    case "topSites": return history().topSites(r.identityId, r.hostId, r.limit ?? 8);
    case "historyDelete": return history().remove(r.target);
    case "passwords": return passwords().passwords(r.identityId);
    case "passwordUpdate": return passwords().update(r.id, r.username);
    case "passwordRemove": return passwords().remove(r.id);
    case "passwordReveal": return passwords().reveal(r.id);
    case "passwordStatus": return passwords().status();
    case "passwordCopy": return passwords().copy(r.id);
    case "neverSave": return passwords().neverSave(r.identityId, r.remove);
    case "promptAnswer": return passwords().answer(r.promptId, r.choice);
    case "fill": return passwords().fill(r.offerId, r.loginId);
    case "dismissOffer": return passwords().dismiss(r.offerId);
    case "syncState": return sync().state();
    case "setHostSync": return sync().setHostSync(r.hostId, r.enabled);
    case "confirmCleanup": return sync().confirmCleanup(r.identityId, r.deletionRevision);
  }
}
