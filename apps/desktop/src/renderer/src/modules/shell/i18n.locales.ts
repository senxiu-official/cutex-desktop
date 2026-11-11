// Performance labels reused by onboarding; loaded with each lazy locale catalog.
import type { zhCN } from "./i18n";

type PerfMessages = Pick<typeof zhCN, "shell.perf.mode" | "shell.perf.save" | "shell.perf.smooth" | "shell.perf.saveHint" | "shell.perf.smoothHint">;

declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof PerfMessages, string> {}
}

export const locales: Record<string, Record<keyof PerfMessages, string>> = {
  "zh-Hant-CN": {
    "shell.perf.mode": "性能模式",
    "shell.perf.save": "節省資源",
    "shell.perf.smooth": "流暢優先",
    "shell.perf.saveHint": "窗口不在前臺時，轉圈、閃爍這些循環動畫暫停；設置等不常用的頁面第一次打開時才加載。",
    "shell.perf.smoothHint": "循環動畫一直運行；不常用的頁面在啓動後空閒時就提前加載，第一次打開也不用等。會多用一些 CPU 和內存。"
  },
  "en-AU": {
    "shell.perf.mode": "Performance mode",
    "shell.perf.save": "Save resources",
    "shell.perf.smooth": "Prefer smoothness",
    "shell.perf.saveHint": "When the window isn't in front, looping animations such as spinners pause; rarely used pages like Settings load the first time you open them.",
    "shell.perf.smoothHint": "Looping animations keep running; rarely used pages load in the background after start, so they open without waiting. Uses a little more CPU and memory."
  },
  "de-DE": {
    "shell.perf.mode": "Leistungsmodus",
    "shell.perf.save": "Ressourcen sparen",
    "shell.perf.smooth": "Glätte bevorzugen",
    "shell.perf.saveHint": "Ist das Fenster im Hintergrund, pausieren laufende Animationen wie drehende Ringe. Selten genutzte Seiten wie Einstellungen laden erst beim ersten Öffnen.",
    "shell.perf.smoothHint": "Laufende Animationen bleiben aktiv. Selten genutzte Seiten laden nach dem Start im Hintergrund und öffnen ohne Wartezeit. Braucht etwas mehr CPU und Arbeitsspeicher."
  },
  "ru-RU": {
    "shell.perf.mode": "Режим производительности",
    "shell.perf.save": "Экономия ресурсов",
    "shell.perf.smooth": "Предпочитаю гладкость",
    "shell.perf.saveHint": "Когда окно в фоне, циклическая анимация, например вращающиеся кольца, приостанавливается. Редко используемые страницы, такие как Настройки, загружаются при первом открытии.",
    "shell.perf.smoothHint": "Циклическая анимация продолжает работать. Редко используемые страницы загружаются в фоне после запуска и открываются без ожидания. Нужно немного больше процессорного времени и памяти."
  },
  "ja-JP": {
    "shell.perf.mode": "パフォーマンスモード",
    "shell.perf.save": "省リソース",
    "shell.perf.smooth": "滑らかさを好む",
    "shell.perf.saveHint": "ウィンドウが前面にないとき、回転や点滅などのループアニメーションを一時停止します。設定など使用頻度の低いページは、初めて開くときに読み込みます。",
    "shell.perf.smoothHint": "ループアニメーションを動かし続けます。使用頻度の低いページも起動後の空き時間に先に読み込み、初めてでも待たずに開けます。CPU とメモリを少し多く使います。"
  },
  "ko-KR": {
    "shell.perf.mode": "성능 모드",
    "shell.perf.save": "리소스 절약",
    "shell.perf.smooth": "부드러움을 선호합니다",
    "shell.perf.saveHint": "창이 앞에 없으면 회전이나 깜빡임 같은 반복 애니메이션을 멈춰요. 설정처럼 자주 쓰지 않는 페이지는 처음 열 때 불러와요.",
    "shell.perf.smoothHint": "반복 애니메이션을 계속 실행해요. 자주 쓰지 않는 페이지도 시작 후 여유 시간에 미리 불러와 처음부터 기다리지 않고 열 수 있어요. CPU와 메모리를 조금 더 사용해요."
  },
  "fr-FR": {
    "shell.perf.mode": "Mode de performances",
    "shell.perf.save": "Économiser les ressources",
    "shell.perf.smooth": "Préférer la douceur",
    "shell.perf.saveHint": "Quand la fenêtre est en arrière-plan, les animations en boucle, comme les indicateurs de chargement, se mettent en pause ; les pages peu utilisées, comme les paramètres, se chargent à leur première ouverture.",
    "shell.perf.smoothHint": "Les animations en boucle restent actives ; les pages peu utilisées se chargent en arrière-plan après le démarrage pour s’ouvrir sans attendre. Utilise un peu plus de CPU et de mémoire."
  },
  "es-ES": {
    "shell.perf.mode": "Modo de rendimiento",
    "shell.perf.save": "Ahorrar recursos",
    "shell.perf.smooth": "Prefiero suavidad",
    "shell.perf.saveHint": "Cuando la ventana está en segundo plano, se pausan las animaciones en bucle, como los indicadores de carga; las páginas poco usadas, como Ajustes, se cargan la primera vez que las abres.",
    "shell.perf.smoothHint": "Las animaciones en bucle siguen activas; las páginas poco usadas se cargan en segundo plano tras el inicio para abrirse sin esperas. Consume algo más de CPU y memoria."
  },
  "it-IT": {
    "shell.perf.mode": "Modalità prestazioni",
    "shell.perf.save": "Risparmia risorse",
    "shell.perf.smooth": "Preferisci la morbidezza",
    "shell.perf.saveHint": "Quando la finestra non è in primo piano, le animazioni ripetute, come gli indicatori di caricamento, si fermano. Le pagine usate di rado, come le Impostazioni, vengono caricate alla prima apertura.",
    "shell.perf.smoothHint": "Le animazioni ripetute restano attive. Dopo l’avvio, le pagine usate di rado vengono caricate in background e si aprono senza attesa. Consuma un po’ più di CPU e memoria."
  },
  "pt-BR": {
    "shell.perf.mode": "Modo de desempenho",
    "shell.perf.save": "Economizar recursos",
    "shell.perf.smooth": "Prefira suavidade",
    "shell.perf.saveHint": "Quando a janela não está em primeiro plano, as animações em repetição, como os indicadores de carregamento, são pausadas. Páginas pouco usadas, como Configurações, só são carregadas na primeira abertura.",
    "shell.perf.smoothHint": "As animações em repetição continuam. Após a inicialização, páginas pouco usadas são carregadas em segundo plano e abrem sem espera. Usa um pouco mais de CPU e memória."
  }
};
