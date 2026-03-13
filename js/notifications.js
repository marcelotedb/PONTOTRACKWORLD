// ============================================================
// PontoTrack - Notifications Module
// ============================================================

class NotificationManager {
  constructor() {
    this.permission = Notification?.permission || 'default';
  }

  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (this.permission === 'granted') return true;
    
    const result = await Notification.requestPermission();
    this.permission = result;
    return result === 'granted';
  }

  async send(title, body, tag = 'pontotrack') {
    if (this.permission !== 'granted') {
      await this.requestPermission();
    }

    if (this.permission === 'granted') {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification(title, {
          body,
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
          vibrate: [200, 100, 200],
          tag,
          renotify: true
        });
      } else {
        new Notification(title, { body, tag });
      }
    }
  }

  scheduleReminder(type, time) {
    // Simple reminder via setTimeout (works while app is open)
    const now = new Date();
    const [hours, minutes] = time.split(':').map(Number);
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    
    if (target <= now) target.setDate(target.getDate() + 1);
    
    const delay = target - now;
    const messages = {
      'entry': 'Hora de registrar sua entrada!',
      'exit': 'Hora de registrar sua saída!',
      'break': 'Hora do intervalo! Não esqueça de registrar.'
    };

    setTimeout(() => {
      this.send('PontoTrack - Lembrete', messages[type] || 'Lembrete de ponto');
    }, delay);
  }
}

window.notifManager = new NotificationManager();
