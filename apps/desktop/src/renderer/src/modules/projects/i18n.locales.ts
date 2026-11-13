// Operator role labels; other project strings keep their existing locale catalogs.
export const locales = {
  "zh-Hant-CN": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "暫無{{operators}}",
    "projects.setOperator": "設為{{operator}}",
    "projects.revokeOperator": "取消{{operator}}",
    "projects.operatorRestartRequired": "{{operator}}授權已更新，重啟後生效",
    "projects.operatorOffline": "{{operator}}授權已更新，下次啟動時生效",
    "projects.operatorRestartNow": "現在重啟",
    "projects.operatorSuccessor": "請先取消 {name} 的{{operator}}授權，再設為{{director}}",
    "projects.operatorMenuArmed": "再左鍵點擊一次：讓 {name} 成為本項目的{{operator}}，可代{{director}}行事",
    "projects.operatorMenuDirector": "{{director}}不能同時是{{operator}}",
    "projects.operatorMenuUnavailable": "這個項目現在不能更改{{operator}}（沒有{{director}}或不在進行中）",
    "projects.operatorMenuFailed": "{action}失敗：{error}",
    "projects.operatorRuntimeUnknown": "{{operator}}授權已更新，重啟後生效；暫時無法讀取運行時狀態",
    "projects.operatorRestartArmed": "再左鍵點擊一次重啟；若有正在進行的回合，將會中斷"
  },
  "ja-JP": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "{{operators}}はいません",
    "projects.setOperator": "{{operator}}にする",
    "projects.revokeOperator": "{{operator}}を解除",
    "projects.operatorRestartRequired": "{{operator}}権限を更新しました。現在のターンは続行し、再起動後に適用されます。",
    "projects.operatorOffline": "{{operator}}権限を更新しました。次回の起動時に適用されます。",
    "projects.operatorRestartNow": "今すぐ再起動",
    "projects.operatorSuccessor": "{name} を {{director}} にする前に {{operator}}権限を解除してください。",
    "projects.operatorRuntimeUnknown": "{{operator}}権限は更新済みです。状態を取得できません。再起動後に適用されます。",
    "projects.operatorRestartArmed": "もう一度クリックして再起動します。進行中のターンは中断されます"
  },
  "ko-KR": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "{{operators}} 없음",
    "projects.setOperator": "{{operator}}로 지정",
    "projects.revokeOperator": "{{operator}} 해제",
    "projects.operatorRestartRequired": "{{operator}} 권한이 변경되었습니다. 현재 턴은 계속되며 재시작 후 적용됩니다.",
    "projects.operatorOffline": "{{operator}} 권한이 변경되었습니다. 다음 시작 시 적용됩니다.",
    "projects.operatorRestartNow": "지금 재시작",
    "projects.operatorSuccessor": "{name}의 {{operator}} 권한을 해제한 뒤 {{director}}로 지정하세요.",
    "projects.operatorRuntimeUnknown": "{{operator}} 권한은 변경되었습니다. 상태를 확인할 수 없습니다. 재시작 후 적용됩니다.",
    "projects.operatorRestartArmed": "다시 클릭하면 재시작하며 진행 중인 턴은 중단됩니다"
  },
  "de-DE": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "Keine {{operators}}",
    "projects.setOperator": "Als {{operator}} festlegen",
    "projects.revokeOperator": "{{operator}} entfernen",
    "projects.operatorRestartRequired": "{{operator}}-Rechte aktualisiert. Der aktuelle Turn läuft weiter; ein Neustart wendet sie an.",
    "projects.operatorOffline": "{{operator}}-Rechte aktualisiert; gültig ab dem nächsten Start.",
    "projects.operatorRestartNow": "Jetzt neu starten",
    "projects.operatorSuccessor": "Entziehe {name} zuerst die {{operator}}-Rechte, bevor du {{director}} zuweist.",
    "projects.operatorRuntimeUnknown": "{{operator}}-Rechte aktualisiert. Laufzeitstatus unbekannt; nach Neustart wirksam.",
    "projects.operatorRestartArmed": "Erneut klicken zum Neustart; ein laufender Turn wird unterbrochen"
  },
  "fr-FR": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "Aucun {{operators}}",
    "projects.setOperator": "Nommer {{operator}}",
    "projects.revokeOperator": "Retirer {{operator}}",
    "projects.operatorRestartRequired": "Droits {{operator}} modifiés. Le tour continue ; redémarrez pour les appliquer.",
    "projects.operatorOffline": "Droits {{operator}} modifiés ; application au prochain démarrage.",
    "projects.operatorRestartNow": "Redémarrer maintenant",
    "projects.operatorSuccessor": "Retirez les droits {{operator}} de {name} avant de nommer {{director}}.",
    "projects.operatorRuntimeUnknown": "Droits {{operator}} modifiés. État du moteur indisponible ; redémarrez pour les appliquer.",
    "projects.operatorRestartArmed": "Cliquez à nouveau pour redémarrer ; tout tour en cours sera interrompu"
  },
  "es-ES": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "Sin {{operators}}",
    "projects.setOperator": "Asignar {{operator}}",
    "projects.revokeOperator": "Quitar {{operator}}",
    "projects.operatorRestartRequired": "Permisos {{operator}} actualizados. El turno continúa; reinicia para aplicarlos.",
    "projects.operatorOffline": "Permisos {{operator}} actualizados; se aplicarán al iniciar.",
    "projects.operatorRestartNow": "Reiniciar ahora",
    "projects.operatorSuccessor": "Revoca el permiso {{operator}} de {name} antes de asignar {{director}}.",
    "projects.operatorRuntimeUnknown": "Permisos {{operator}} actualizados. Estado del motor no disponible; reinicia para aplicarlos.",
    "projects.operatorRestartArmed": "Haz clic de nuevo para reiniciar; se interrumpirá cualquier turno activo"
  },
  "it-IT": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "Nessun {{operators}}",
    "projects.setOperator": "Assegna {{operator}}",
    "projects.revokeOperator": "Rimuovi {{operator}}",
    "projects.operatorRestartRequired": "Permessi {{operator}} aggiornati. Il turno continua; riavvia per applicarli.",
    "projects.operatorOffline": "Permessi {{operator}} aggiornati; attivi al prossimo avvio.",
    "projects.operatorRestartNow": "Riavvia ora",
    "projects.operatorSuccessor": "Revoca il ruolo {{operator}} di {name} prima di assegnare {{director}}.",
    "projects.operatorRuntimeUnknown": "Permessi {{operator}} aggiornati. Stato del runtime non disponibile; riavvia per applicarli.",
    "projects.operatorRestartArmed": "Fai di nuovo clic per riavviare; i turni attivi verranno interrotti"
  },
  "pt-BR": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "Nenhum {{operators}}",
    "projects.setOperator": "Definir {{operator}}",
    "projects.revokeOperator": "Remover {{operator}}",
    "projects.operatorRestartRequired": "Permissões {{operator}} atualizadas. O turno continua; reinicie para aplicar.",
    "projects.operatorOffline": "Permissões {{operator}} atualizadas; serão aplicadas na próxima inicialização.",
    "projects.operatorRestartNow": "Reiniciar agora",
    "projects.operatorSuccessor": "Revogue {{operator}} de {name} antes de definir {{director}}.",
    "projects.operatorRuntimeUnknown": "Permissões {{operator}} atualizadas. Estado do runtime indisponível; reinicie para aplicar.",
    "projects.operatorRestartArmed": "Clique novamente para reiniciar; qualquer turno ativo será interrompido"
  },
  "ru-RU": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "Нет {{operators}}",
    "projects.setOperator": "Назначить {{operator}}",
    "projects.revokeOperator": "Снять {{operator}}",
    "projects.operatorRestartRequired": "Права {{operator}} обновлены. Текущий ход продолжается; примените их перезапуском.",
    "projects.operatorOffline": "Права {{operator}} обновлены; вступят в силу при следующем запуске.",
    "projects.operatorRestartNow": "Перезапустить сейчас",
    "projects.operatorSuccessor": "Сначала снимите роль {{operator}} с {name}, затем назначьте {{director}}.",
    "projects.operatorRuntimeUnknown": "Права {{operator}} обновлены. Состояние среды недоступно; перезапустите её.",
    "projects.operatorRestartArmed": "Нажмите ещё раз для перезапуска; текущий ход будет прерван"
  },
  "en-AU": {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "No {{operators}}",
    "projects.setOperator": "Make {{operator}}",
    "projects.revokeOperator": "Remove {{operator}}",
    "projects.operatorRestartRequired": "{{Operator}} permissions updated; the current turn continues. Restart to apply.",
    "projects.operatorOffline": "{{Operator}} permissions updated; they apply on the next start.",
    "projects.operatorRestartNow": "Restart now",
    "projects.operatorSuccessor": "Revoke {name}’s {{operator}} grant before making them {{director}}.",
    "projects.operatorMenuArmed": "Click again: make {name} this project's {{operator}}, able to act for the {{director}}",
    "projects.operatorMenuDirector": "The {{director}} can't also be {{operator}}",
    "projects.operatorMenuUnavailable": "{{Operator}} grants can't be changed in this project right now (no {{director}}, or not active)",
    "projects.operatorMenuFailed": "{action} failed: {error}",
    "projects.operatorRuntimeUnknown": "{{Operator}} permissions updated. Runtime status is unavailable; restart to apply.",
    "projects.operatorRestartArmed": "Click again to restart; any active turn will be interrupted"
  }
};
declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof typeof locales["zh-Hant-CN"], string> {}
}
