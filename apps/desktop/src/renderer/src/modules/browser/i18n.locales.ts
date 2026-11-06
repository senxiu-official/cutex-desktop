import type { zhCN } from "./i18n";
const zhHantCN = {
  "browser.error.serviceManuallyStopped": "這個服務已被手動停止。請到「服務」頁選擇「啓動」；重新加載不會啓動它。",
  "browser.error.serviceWakeFailed": "服務未能完成喚醒。請到「服務」頁查看日誌，再選擇「喚醒」重試；不會自動重試啓動。",
};
declare module "../i18nCatalog" { interface ModuleZhHantMessages extends Record<keyof typeof zhHantCN, string> {} }

/** Precise idle-wake/manual-stop errors; older service error wording is unchanged. */
export const locales: Record<string, Partial<Record<keyof typeof zhCN, string>>> = {
  "zh-Hant-CN": zhHantCN,
  "ja-JP": {
    "browser.error.serviceManuallyStopped": "このサービスは手動で停止されています。「サービス」で「起動」を選んでください。再読み込みでは起動しません。",
    "browser.error.serviceWakeFailed": "サービスのスリープを解除できませんでした。「サービス」でログを確認し、「スリープ解除」で再試行してください。起動は自動的に再試行されません。",
  },
  "ko-KR": {
    "browser.error.serviceManuallyStopped": "이 서비스는 수동으로 중지되었습니다. 서비스 페이지에서 시작을 선택하세요. 새로고침으로는 시작되지 않습니다.",
    "browser.error.serviceWakeFailed": "서비스를 깨우지 못했습니다. 서비스 페이지에서 로그를 확인한 뒤 깨우기를 선택하세요. 자동으로 시작을 다시 시도하지 않습니다.",
  },
  "de-DE": {
    "browser.error.serviceManuallyStopped": "Dieser Dienst wurde manuell gestoppt. Wählen Sie Start auf der Seite Dienste; Neuladen startet ihn nicht.",
    "browser.error.serviceWakeFailed": "Der Dienst konnte nicht aufwachen. Prüfen Sie die Protokolle unter Dienste und wählen Sie Aufwecken. Der Start wird nicht automatisch wiederholt.",
  },
  "fr-FR": {
    "browser.error.serviceManuallyStopped": "Ce service a été arrêté manuellement. Choisissez Démarrer sur la page Services ; le rechargement ne le démarre pas.",
    "browser.error.serviceWakeFailed": "Le service n’a pas pu se réveiller. Consultez ses journaux dans Services, puis choisissez Réveiller. Le démarrage ne sera pas retenté automatiquement.",
  },
  "es-ES": {
    "browser.error.serviceManuallyStopped": "Este servicio se detuvo manualmente. Elija Iniciar en Servicios; recargar no lo inicia.",
    "browser.error.serviceWakeFailed": "El servicio no pudo despertarse. Revise sus registros en Servicios y elija Despertar. No se reintentará el inicio automáticamente.",
  },
  "it-IT": {
    "browser.error.serviceManuallyStopped": "Questo servizio è stato arrestato manualmente. Scegli Avvia nella pagina Servizi; ricaricare non lo avvia.",
    "browser.error.serviceWakeFailed": "Il servizio non è stato riattivato. Controlla i log nella pagina Servizi, poi scegli Riattiva. L’avvio non verrà ritentato automaticamente.",
  },
  "pt-BR": {
    "browser.error.serviceManuallyStopped": "Este serviço foi interrompido manualmente. Selecione Iniciar em Serviços; recarregar não o inicia.",
    "browser.error.serviceWakeFailed": "O serviço não pôde despertar. Consulte os logs em Serviços e selecione Despertar. A inicialização não será repetida automaticamente.",
  },
  "ru-RU": {
    "browser.error.serviceManuallyStopped": "Сервис остановлен вручную. Выберите «Запустить» на странице «Сервисы»; перезагрузка страницы его не запустит.",
    "browser.error.serviceWakeFailed": "Сервис не удалось разбудить. Проверьте журналы на странице «Сервисы» и выберите «Разбудить». Автоматических повторных запусков не будет.",
  },
  "en-AU": {
    "browser.error.serviceManuallyStopped": "This service was manually stopped. Choose Start on the Services page; reloading will not start it.",
    "browser.error.serviceWakeFailed": "The service could not finish waking. Check its logs on the Services page, then choose Wake to retry. Startup will not retry automatically.",
  },
};
