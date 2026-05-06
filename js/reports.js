class ReportsManager {
  
  async generateReport(format, filters) {
    const { employeeId, startDate, endDate } = filters;
    let allRecords = await window.ptDB.getAll('records');
    let allEmployees = await window.ptDB.getAll('employees');
    
    let filtered = [...allRecords];
    if (employeeId && employeeId !== 'all') {
      filtered = filtered.filter(r => r.employeeId === employeeId);
    }
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      filtered = filtered.filter(r => new Date(r.timestamp) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(r => new Date(r.timestamp) <= end);
    }
    
    filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    if (format === 'view') {
      return this._renderReport(filtered, allEmployees);
    } else if (format === 'excel') {
      return this._exportExcel(filtered, allEmployees);
    } else if (format === 'pdf') {
      return this._exportPDF(filtered, allEmployees);
    }
  }

  _renderReport(records, employees) {
    if (records.length === 0) return `<div class="empty-state"><i class="fas fa-search"></i><h3>Nenhum registro</h3></div>`;

    const summary = this._processData(records, employees);
    let html = `<div class="report-summary"><div class="report-summary-grid">`;
    
    let totalWorked = 0;
    let totalEmployees = Object.keys(summary).length;
    Object.values(summary).forEach(s => totalWorked += s.totalWorked);

    html += `
      <div><div class="report-summary-value">${totalEmployees}</div><div class="report-summary-label">EQUIPE</div></div>
      <div><div class="report-summary-value">${this._formatMinutes(totalWorked)}</div><div class="report-summary-label">TOTAL HORAS</div></div>
    </div></div><div class="records-list">`;

    records.forEach(r => {
      const emp = employees.find(e => e.id === r.employeeId) || { name: 'Desconhecido' };
      
      let borderClass = 'border-entry'; 
      if (r.type === 'exit') borderClass = 'border-exit';
      if (r.type === 'break' || r.type === 'lunch' || r.type === 'break_end' || r.type === 'lunch_end') borderClass = 'border-break';

      const typeLabels = {
        entry: 'Entrada', exit: 'Saída', break: 'Pausa',
        break_end: 'Retorno', lunch: 'Almoço', lunch_end: 'Ret. Almoço'
      };

      const observationHtml = r.observation ? `<div class="record-obs"><i class="fas fa-comment-dots"></i> ${r.observation}</div>` : '';
      const locationHtml = r.lat ? `<div class="record-location-small"><i class="fas fa-map-marker-alt"></i> ${parseFloat(r.lat).toFixed(4)}, ${parseFloat(r.lng).toFixed(4)}</div>` : '';

      html += `
        <div class="record-item ${borderClass}" style="flex-wrap: wrap; cursor: pointer;" onclick="window.app.viewRecordDetails('records', '${r.id}')">
          <div style="display:flex; width: 100%; justify-content: space-between; align-items:center;">
            <div class="record-info">
              <div class="record-details">
                <h4 style="margin-bottom:4px;">${emp.name}</h4>
                <div style="font-size:12px; font-weight:600; color:var(--text-secondary);">
                  ${typeLabels[r.type] || r.type.toUpperCase()}
                </div>
                ${locationHtml}
              </div>
            </div>
            <div class="record-time" style="text-align:right;">
              <div class="time" style="font-size:15px;">${r.time}</div>
              <div class="date" style="font-size:11px;">${r.date}</div>
            </div>
          </div>
          ${observationHtml}
        </div>`;
    });

    return html + '</div>';
  }

  _processData(records, employees) {
    const data = {};
    records.forEach(r => {
      if (!data[r.employeeId]) {
        const emp = employees.find(e => e.id === r.employeeId) || { name: 'Desconhecido', role: '' };
        data[r.employeeId] = { info: emp, days: {}, totalWorked: 0, totalOvertime: 0, totalOvertimeValue: 0, daysWorked: 0 };
      }
      if (!data[r.employeeId].days[r.date]) data[r.employeeId].days[r.date] = [];
      data[r.employeeId].days[r.date].push(r);
    });

    const result = {};
    Object.entries(data).forEach(([empId, empData]) => {
      let accumulatedOvertimeMin = 0;
      const dayStats = Object.entries(empData.days).map(([date, dayRecs]) => {
        const stats = this._calculateDayStats(dayRecs, empData.info);
        empData.totalWorked += stats.worked;
        empData.daysWorked++;
        accumulatedOvertimeMin += stats.netOvertime;
        if (accumulatedOvertimeMin < 0) accumulatedOvertimeMin = 0;
        return { ...stats, overtime: stats.netOvertime > 0 ? stats.netOvertime : 0 };
      });
      empData.totalOvertime = Math.max(0, accumulatedOvertimeMin);
      empData.totalOvertimeValue = this._calculateMonthlyOvertimeValue(empData.totalOvertime, empData.info);
      result[empId] = { ...empData, processedDays: dayStats.sort((a,b) => this._parseDate(a.date) - this._parseDate(b.date)) };
    });
    return result;
  }

  _calculateDayStats(dayRecords, empInfo) {
    const sorted = [...dayRecords].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const entry = dayRecords.find(r => r.type === 'entry');
    const exit = dayRecords.find(r => r.type === 'exit');
    const lunchOut = dayRecords.find(r => r.type === 'lunch' || r.type === 'break');
    const lunchIn = dayRecords.find(r => r.type === 'lunch_end' || r.type === 'break_end');
    const extraEntry = dayRecords.find(r => r.type === 'extra_entry');
    const extraExit = dayRecords.find(r => r.type === 'extra_exit');

    const dateStr = dayRecords[0].date;
    const dateObj = this._parseDate(dateStr);
    const dayOfWeekStr = this._getWeekdayName(dateStr);
    const dayIndex = dateObj.getDay();
    const isSaturday = dayIndex === 6;

    const empName = (empInfo?.name || '').toLowerCase();
    const isSpecialEmp = empName.includes('raimundo') || empName.includes('joao adelmo') || empName.includes('joão adelmo');

    // ── Horários de referência para registros ausentes ──
    const REF_ENTRY = '07:30';
    const REF_EXIT = isSaturday ? '11:30' : '17:30';

    // Determinar se vamos usar valores de referência para entry/exit
    // (não se aplica a serviços extra isolados ou dias sem nenhum registro regular)
    const hasRegularEntry = !!entry;
    const hasRegularExit = !!exit;
    const hasAnyRegularRecord = hasRegularEntry || hasRegularExit || !!lunchOut || !!lunchIn;

    let usedRefEntry = false;
    let usedRefExit = false;

    // Montar string de entrada/saída para exibição e timestamps sintéticos para cálculo
    let entryTimeStr = '--:--';
    let exitTimeStr = '--:--';
    let entryTimestamp = null;
    let exitTimestamp = null;

    if (hasRegularEntry) {
      entryTimeStr = entry.time;
      entryTimestamp = new Date(entry.timestamp);
    } else if (extraEntry && !hasAnyRegularRecord) {
      // Apenas serviço extra, sem registros regulares - não aplicar referência
      entryTimeStr = `Extra: ${extraEntry.time}`;
      entryTimestamp = new Date(extraEntry.timestamp);
    } else if (hasAnyRegularRecord) {
      // Falta entrada mas tem outros registros regulares → usar referência
      entryTimeStr = REF_ENTRY;
      usedRefEntry = true;
      const [rH, rM] = REF_ENTRY.split(':').map(Number);
      entryTimestamp = new Date(dateObj);
      entryTimestamp.setHours(rH, rM, 0, 0);
    }

    if (hasRegularExit) {
      exitTimeStr = exit.time;
      exitTimestamp = new Date(exit.timestamp);
    } else if (extraExit && !hasAnyRegularRecord) {
      exitTimeStr = `Extra: ${extraExit.time}`;
      exitTimestamp = new Date(extraExit.timestamp);
    } else if (hasAnyRegularRecord) {
      // Falta saída mas tem outros registros regulares → usar referência
      exitTimeStr = REF_EXIT;
      usedRefExit = true;
      const [rH, rM] = REF_EXIT.split(':').map(Number);
      exitTimestamp = new Date(dateObj);
      exitTimestamp.setHours(rH, rM, 0, 0);
    }

    // ── Recalcular horas trabalhadas usando timestamps reais + sintéticos ──
    // Construir lista combinada de eventos, substituindo entry/exit faltantes pelos de referência
    const calcRecords = [];
    
    for (const r of sorted) {
      if (r.type === 'entry' || r.type === 'exit') {
        calcRecords.push({ type: r.type, timestamp: new Date(r.timestamp) });
      } else if (r.type === 'extra_entry' || r.type === 'extra_exit') {
        calcRecords.push({ type: r.type, timestamp: new Date(r.timestamp) });
      } else {
        // lunch, lunch_end, break, break_end
        calcRecords.push({ type: r.type, timestamp: new Date(r.timestamp) });
      }
    }

    // Injetar entry de referência se não existe
    if (!hasRegularEntry && usedRefEntry && entryTimestamp) {
      calcRecords.push({ type: 'entry', timestamp: entryTimestamp, synthetic: true });
    }
    // Injetar exit de referência se não existe
    if (!hasRegularExit && usedRefExit && exitTimestamp) {
      calcRecords.push({ type: 'exit', timestamp: exitTimestamp, synthetic: true });
    }

    // Reordenar
    calcRecords.sort((a, b) => a.timestamp - b.timestamp);

    // Calcular minutos trabalhados (total e extra separadamente)
    let workedMin = 0;
    let extraWorkedMin = 0;
    let currentEntry = null;
    let inExtraSegment = false;

    for (const r of calcRecords) {
      if (r.type === 'entry') {
        if (!currentEntry) { currentEntry = r.timestamp; inExtraSegment = false; }
      } else if (r.type === 'extra_entry') {
        if (!currentEntry) { currentEntry = r.timestamp; inExtraSegment = true; }
      } else if ((r.type === 'break' || r.type === 'lunch') && currentEntry) {
        const mins = Math.max(0, Math.floor((r.timestamp - currentEntry) / 60000));
        workedMin += mins;
        if (inExtraSegment) extraWorkedMin += mins;
        currentEntry = null;
      } else if ((r.type === 'break_end' || r.type === 'lunch_end') && !currentEntry) {
        currentEntry = r.timestamp;
        // Retorno de pausa é sempre jornada regular
        inExtraSegment = false;
      } else if (r.type === 'exit' && currentEntry) {
        const mins = Math.max(0, Math.floor((r.timestamp - currentEntry) / 60000));
        workedMin += mins;
        if (inExtraSegment) extraWorkedMin += mins;
        currentEntry = null;
      } else if (r.type === 'extra_exit' && currentEntry) {
        const mins = Math.max(0, Math.floor((r.timestamp - currentEntry) / 60000));
        workedMin += mins;
        extraWorkedMin += mins;
        currentEntry = null;
      }
    }

    // Se terminou com entry aberto (sem exit e sem referência), fechar com agora apenas se for hoje
    if (currentEntry && !usedRefExit) {
      const today = new Date().toLocaleDateString('pt-BR');
      if (dateStr === today) {
        const mins = Math.max(0, Math.floor((new Date() - currentEntry) / 60000));
        workedMin += mins;
        if (inExtraSegment) extraWorkedMin += mins;
      }
    }

    // ── Flag: dia com APENAS serviço extra (sem registros regulares) ──
    const onlyExtraService = !hasAnyRegularRecord && (!!extraEntry || !!extraExit);

    // ── Feriado nacional ──
    const isNationalHoliday = this._isNationalHoliday(dateStr);

    // ── Jornada esperada ──
    // Feriados nacionais e dias só de serviço extra → jornada esperada = 0
    let expectedMin = 8 * 60;
    if (isNationalHoliday || onlyExtraService) {
      expectedMin = 0;
    } else if (isSpecialEmp) {
      if (dayIndex === 6 || dayIndex === 0) expectedMin = 0;
    } else {
      if (dayIndex === 0) expectedMin = 0;
      else if (dayIndex === 6) expectedMin = 4 * 60;
    }

    const netOvertime = workedMin - expectedMin;
    const overtimeMin = Math.max(0, netOvertime);
    let overtimeValue = 0;
    if (overtimeMin > 0) overtimeValue = this._calculateHourlyRate(overtimeMin, dayIndex, isSpecialEmp, empInfo);

    // ── Notas ──
    let notes = dayRecords.map(r => r.observation).filter(Boolean).join('; ');
    if (extraEntry) notes = `[Serviço Extra] ${notes}`;
    if (isNationalHoliday) {
      const hName = this._getHolidayName(dateStr);
      notes = notes ? `[Feriado: ${hName}] ${notes}` : `[Feriado: ${hName}]`;
    }
    const refNotes = [];
    if (usedRefEntry) refNotes.push(`Entrada ref. ${REF_ENTRY}`);
    if (usedRefExit) refNotes.push(`Saída ref. ${REF_EXIT}`);
    if (refNotes.length > 0) {
      notes = notes ? `${notes} | [${refNotes.join(', ')}]` : `[${refNotes.join(', ')}]`;
    }

    return {
      date: dateStr, dayOfWeek: dayOfWeekStr,
      entry: entryTimeStr,
      lunchOut: lunchOut ? lunchOut.time : '--:--',
      lunchIn: lunchIn ? lunchIn.time : '--:--',
      exit: exitTimeStr,
      worked: workedMin, overtime: overtimeMin, netOvertime, overtimeValue, notes,
      usedRefEntry, usedRefExit, extraWorkedMin, onlyExtraService,
      isNationalHoliday, expectedMin
    };
  }

  _calculateHourlyRate(minutes, dayIndex, isSpecialEmp, empInfo) {
    if (minutes <= 0) return 0;
    const hours = minutes / 60;
    if (isSpecialEmp) return hours * 50.00;
    const salary = parseFloat(empInfo?.salary) || 1412.00;
    const baseHourValue = salary / 220;
    const multiplier = (dayIndex === 0) ? 2.0 : 1.5;
    return hours * (baseHourValue * multiplier);
  }

  _calculateMonthlyOvertimeValue(totalOvertimeMin, empInfo) {
    if (totalOvertimeMin <= 0) return 0;
    const empName = (empInfo?.name || '').toLowerCase();
    const isSpecialEmp = empName.includes('raimundo') || empName.includes('joao adelmo') || empName.includes('joão adelmo');
    return this._calculateHourlyRate(totalOvertimeMin, 1, isSpecialEmp, empInfo);
  }

  // ── Feriados Nacionais Brasileiros ──

  _getEasterDate(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  _getNationalHolidays(year) {
    const holidays = new Set();
    const pad = n => String(n).padStart(2, '0');
    const add = (d, m) => holidays.add(`${pad(d)}/${pad(m)}/${year}`);
    // Feriados fixos nacionais
    add(1, 1);   // Confraternização Universal
    add(21, 4);  // Tiradentes
    add(1, 5);   // Dia do Trabalho
    add(7, 9);   // Independência do Brasil
    add(12, 10); // Nossa Senhora Aparecida
    add(2, 11);  // Finados
    add(15, 11); // Proclamação da República
    add(20, 11); // Consciência Negra
    add(25, 12); // Natal
    // Sexta-feira Santa (variável – 2 dias antes da Páscoa)
    const easter = this._getEasterDate(year);
    const gf = new Date(easter);
    gf.setDate(gf.getDate() - 2);
    add(gf.getDate(), gf.getMonth() + 1);
    return holidays;
  }

  _isNationalHoliday(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return false;
    return this._getNationalHolidays(parseInt(parts[2])).has(dateStr);
  }

  _getHolidayName(dateStr) {
    const [dStr, mStr, yStr] = dateStr.split('/');
    const d = parseInt(dStr), m = parseInt(mStr), y = parseInt(yStr);
    const map = {
      '1/1': 'Confraternização Universal', '21/4': 'Tiradentes',
      '1/5': 'Dia do Trabalho', '7/9': 'Independência do Brasil',
      '12/10': 'N. Sra. Aparecida', '2/11': 'Finados',
      '15/11': 'Proclamação da República', '20/11': 'Consciência Negra',
      '25/12': 'Natal'
    };
    if (map[`${d}/${m}`]) return map[`${d}/${m}`];
    const gf = new Date(this._getEasterDate(y));
    gf.setDate(gf.getDate() - 2);
    if (gf.getDate() === d && (gf.getMonth() + 1) === m) return 'Sexta-feira Santa';
    return 'Feriado Nacional';
  }

  _getWeekdayName(dateStr) {
    try {
      const [d, m, y] = dateStr.split('/');
      return new Date(y, m-1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
    } catch { return ''; }
  }

  _parseDate(dateStr) {
    const [d, m, y] = dateStr.split('/');
    return new Date(y, m-1, d);
  }

  _formatMinutes(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // ==================== EXCEL PROFISSIONAL ====================

  // Converte string "HH:MM" ou "Extra: HH:MM" para valor numérico Excel (fração do dia)
  _timeToExcel(timeStr) {
    if (!timeStr || timeStr === '--:--') return null;
    const clean = timeStr.replace('Extra: ', '');
    const parts = clean.split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    if (isNaN(h) || isNaN(m)) return null;
    return (h + m / 60) / 24;
  }

  _getBorder() {
    const thin = { style: 'thin', color: { rgb: 'CBD5E1' } };
    return { top: thin, bottom: thin, left: thin, right: thin };
  }

  _exportExcel(records, employees) {
    if (typeof XLSX === 'undefined') return;
    const summary = this._processData(records, employees);
    const wb = XLSX.utils.book_new();

    Object.values(summary).forEach(emp => {
      const ws = {};
      const merge = [];
      const colWidths = [
        { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
        { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 },
        { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 30 }
      ];

      const salary = parseFloat(emp.info?.salary) || 1412.00;
      const empName = (emp.info?.name || '').toLowerCase();
      const isSpecialEmp = empName.includes('raimundo') || empName.includes('joao adelmo') || empName.includes('joão adelmo');
      const brd = this._getBorder();

      let row = 0;

      // ── CABEÇALHO ──
      const hdrStyle = { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center", vertical: "center" } };
      const subStyle = { font: { bold: true, sz: 11, color: { rgb: "CBD5E1" } }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center", vertical: "center" } };

      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "PONTOTRACK - CARTÃO DE PONTO", t: 's', s: hdrStyle };
      merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 11 } });
      row++;
      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "Sistema de Controle de Ponto Eletrônico", t: 's', s: subStyle };
      merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 11 } });
      row += 2;

      // ── DADOS DO FUNCIONÁRIO ──
      const lblSt = { font: { bold: true, sz: 11, color: { rgb: "334155" } }, fill: { fgColor: { rgb: "F1F5F9" } }, alignment: { horizontal: "left" }, border: brd };
      const valSt = { font: { sz: 11, color: { rgb: "0F172A" } }, fill: { fgColor: { rgb: "F8FAFC" } }, alignment: { horizontal: "left" }, border: brd };

      const infoData = [
        ['Funcionário:', emp.info.name, 'ID / Matrícula:', emp.info.id],
        ['Cargo:', emp.info.role || 'Não informado', 'Departamento:', emp.info.dept || 'Operacional'],
        ['Salário Base:', 'R$ ' + salary.toFixed(2), 'Valor Hora (base):', 'R$ ' + (salary / 220).toFixed(2)],
      ];
      infoData.forEach(r => {
        ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: r[0], t: 's', s: lblSt };
        ws[XLSX.utils.encode_cell({ r: row, c: 1 })] = { v: r[1], t: 's', s: valSt };
        merge.push({ s: { r: row, c: 1 }, e: { r: row, c: 4 } });
        ws[XLSX.utils.encode_cell({ r: row, c: 5 })] = { v: r[2], t: 's', s: lblSt };
        ws[XLSX.utils.encode_cell({ r: row, c: 6 })] = { v: r[3], t: 's', s: valSt };
        merge.push({ s: { r: row, c: 6 }, e: { r: row, c: 8 } });
        row++;
      });
      row++;

      // ── CABEÇALHO DA TABELA ──
      const thSt = { font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E40AF" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: brd };
      const headers = ['Data', 'Dia', 'Entrada', 'Saída Almoço', 'Ret. Almoço', 'Saída', 'Jornada Esperada', 'Horas Trabalhadas', 'Horas Extras', 'Saldo', 'Valor Extra (R$)', 'Observações'];
      headers.forEach((h, c) => {
        ws[XLSX.utils.encode_cell({ r: row, c })] = { v: h, t: 's', s: thSt };
      });
      row++;

      // ── DADOS DIÁRIOS COM FÓRMULAS ──
      const dataStartRow = row;

      emp.processedDays.forEach((d, idx) => {
        // Feriados nacionais recebem fundo laranja claro; demais alternam branco/cinza
        const bg = d.isNationalHoliday ? "FEF3C7" : (idx % 2 === 0 ? "FFFFFF" : "F1F5F9");
        const fontColor = d.isNationalHoliday ? "92400E" : "1E293B";
        const cSt = { font: { sz: 10, color: { rgb: fontColor } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "center" }, border: brd };
        const tmSt = { font: { sz: 10, color: { rgb: fontColor } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "center" }, border: brd, numFmt: 'h:mm' };
        const drSt = { font: { sz: 10, color: { rgb: fontColor } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "center" }, border: brd, numFmt: '[h]:mm' };
        const mSt = { font: { sz: 10, color: { rgb: fontColor } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "right" }, border: brd, numFmt: 'R$ #,##0.00' };
        const nSt = { font: { sz: 9, color: { rgb: d.isNationalHoliday ? "92400E" : "64748B" } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "left", wrapText: true }, border: brd };

        const dateObj = this._parseDate(d.date);
        const dayIdx = dateObj.getDay();
        // Jornada esperada vem diretamente do _calculateDayStats (já considera feriados nacionais)
        const expectedH = (d.expectedMin ?? 0) / 60;

        const R = row + 1; // Excel 1-indexed

        // Estilos para referência e serviço extra
        const refTmSt = { font: { sz: 10, italic: true, color: { rgb: "6366F1" } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "center" }, border: brd, numFmt: 'h:mm' };
        const extraTmSt = { font: { sz: 10, italic: true, color: { rgb: "D97706" } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "center" }, border: brd, numFmt: 'h:mm' };

        // A=Data, B=Dia (texto)
        ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: d.date, t: 's', s: cSt };
        ws[XLSX.utils.encode_cell({ r: row, c: 1 })] = { v: d.dayOfWeek, t: 's', s: cSt };

        // Determinar estilo de entrada
        const eVal = this._timeToExcel(d.entry);
        let entryStyle = tmSt;
        if (d.usedRefEntry) entryStyle = refTmSt;
        else if (d.onlyExtraService) entryStyle = extraTmSt;

        // C=Entrada
        ws[XLSX.utils.encode_cell({ r: row, c: 2 })] = eVal !== null
          ? { v: eVal, t: 'n', s: entryStyle } : { v: '', t: 's', s: cSt };

        // D=Saída Almoço
        const loVal = this._timeToExcel(d.lunchOut);
        ws[XLSX.utils.encode_cell({ r: row, c: 3 })] = loVal !== null
          ? { v: loVal, t: 'n', s: tmSt } : { v: '', t: 's', s: cSt };

        // E=Retorno Almoço
        const liVal = this._timeToExcel(d.lunchIn);
        ws[XLSX.utils.encode_cell({ r: row, c: 4 })] = liVal !== null
          ? { v: liVal, t: 'n', s: tmSt } : { v: '', t: 's', s: cSt };

        // Determinar estilo de saída
        const xVal = this._timeToExcel(d.exit);
        let exitStyle = tmSt;
        if (d.usedRefExit) exitStyle = refTmSt;
        else if (d.onlyExtraService) exitStyle = extraTmSt;

        // F=Saída
        ws[XLSX.utils.encode_cell({ r: row, c: 5 })] = xVal !== null
          ? { v: xVal, t: 'n', s: exitStyle } : { v: '', t: 's', s: cSt };

        // G=Jornada Esperada (duração: expectedH/24 formatada [h]:mm)
        ws[XLSX.utils.encode_cell({ r: row, c: 6 })] = { v: expectedH / 24, t: 'n', s: drSt };

        // H=Horas Trabalhadas = FÓRMULA AUTOMÁTICA
        // Fórmula base: SE(E(ÉNÚMERO(C);ÉNÚMERO(F)); SE(E(ÉNÚMERO(D);ÉNÚMERO(E)); (F-C)-(E-D); F-C); 0)
        let fH = `IF(AND(ISNUMBER(C${R}),ISNUMBER(F${R})),IF(AND(ISNUMBER(D${R}),ISNUMBER(E${R})),(F${R}-C${R})-(E${R}-D${R}),F${R}-C${R}),0)`;
        
        // Se tem serviço extra JUNTO com jornada regular, adicionar horas extra como constante
        // (as horas extra não estão nas colunas C/F pois essas mostram a jornada regular)
        if (d.extraWorkedMin > 0 && !d.onlyExtraService) {
          const extraFraction = d.extraWorkedMin / (24 * 60);
          fH = `${fH}+${extraFraction.toFixed(10)}`;
        }
        ws[XLSX.utils.encode_cell({ r: row, c: 7 })] = { f: fH, t: 'n', s: drSt };

        // I=Horas Extras: =SE(H-G>0; H-G; 0)
        ws[XLSX.utils.encode_cell({ r: row, c: 8 })] = { f: `IF(H${R}-G${R}>0,H${R}-G${R},0)`, t: 'n', s: drSt };

        // J=Saldo: =H-G
        ws[XLSX.utils.encode_cell({ r: row, c: 9 })] = { f: `H${R}-G${R}`, t: 'n', s: drSt };

        // K=Valor Extra (R$): =I*24*taxaHora (converte fração do dia para horas * taxa)
        const mult = (dayIdx === 0) ? 2.0 : 1.5;
        const rate = isSpecialEmp ? 50.00 : (salary / 220);
        ws[XLSX.utils.encode_cell({ r: row, c: 10 })] = { f: `I${R}*24*${(rate * mult).toFixed(4)}`, t: 'n', s: mSt };

        // L=Observações
        ws[XLSX.utils.encode_cell({ r: row, c: 11 })] = { v: d.notes || '', t: 's', s: nSt };

        row++;
      });

      const first = dataStartRow + 1;
      const last = row;
      row++;

      // ── RESUMO COM FÓRMULAS ──
      const sLbl = { font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "right" }, border: brd };
      const sTm = { font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E40AF" } }, alignment: { horizontal: "center" }, border: brd, numFmt: '[h]:mm' };
      const sCnt = { font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E40AF" } }, alignment: { horizontal: "center" }, border: brd };
      const sMon = { font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "15803D" } }, alignment: { horizontal: "center" }, border: brd, numFmt: 'R$ #,##0.00' };

      // Titulo
      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "RESUMO DO PERÍODO", t: 's', s: { font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center" } } };
      merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 11 } });
      row++;

      const summaryRows = [
        { label: "Dias Trabalhados:", formula: `COUNTA(A${first}:A${last})`, style: sCnt },
        { label: "Total Jornada Esperada:", formula: `SUM(G${first}:G${last})`, style: sTm },
        { label: "Total Horas Trabalhadas:", formula: `SUM(H${first}:H${last})`, style: sTm },
        { label: "Total Horas Extras:", formula: `SUM(I${first}:I${last})`, style: sTm },
        { label: "Saldo / Banco de Horas:", formula: `SUM(J${first}:J${last})`, style: sTm },
        { label: "Valor Total Horas Extras:", formula: `SUM(K${first}:K${last})`, style: sMon },
        { label: "Média por Dia:", formula: `IFERROR(SUM(H${first}:H${last})/COUNTA(A${first}:A${last}),0)`, style: sTm },
      ];

      summaryRows.forEach(sr => {
        ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: sr.label, t: 's', s: sLbl };
        merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 5 } });
        ws[XLSX.utils.encode_cell({ r: row, c: 6 })] = { f: sr.formula, t: 'n', s: sr.style };
        merge.push({ s: { r: row, c: 6 }, e: { r: row, c: 8 } });
        row++;
      });

      row++;

      // ── LEGENDA ──
      const lgSt = { font: { italic: true, sz: 9, color: { rgb: "94A3B8" } } };
      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "Instruções:", t: 's', s: { font: { bold: true, sz: 9, color: { rgb: "64748B" } } } };
      row++;

      const legendas = [
        "Todos os horários estão em formato HH:MM. Edite as células de Entrada (C), Saída Almoço (D), Ret. Almoço (E) e Saída (F).",
        "Ao alterar qualquer horário, Horas Trabalhadas (H), Extras (I), Saldo (J), Valor (K) e TODOS os totais recalculam automaticamente.",
        "Para alterar a jornada esperada de um dia, edite a coluna G (ex: para meio período, digite 4:00).",
        "Horários em itálico (azul) são valores de referência (Seg-Sex: 07:30/17:30 | Sáb: 07:30/11:30) aplicados por ausência de registro.",
        "Gerado por PontoTrack em " + new Date().toLocaleDateString('pt-BR') + " às " + new Date().toLocaleTimeString('pt-BR'),
      ];
      legendas.forEach(txt => {
        ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "• " + txt, t: 's', s: lgSt };
        merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 11 } });
        row++;
      });

      // ── PROPRIEDADES ──
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: 11 } });
      ws['!cols'] = colWidths;
      ws['!merges'] = merge;

      XLSX.utils.book_append_sheet(wb, ws, emp.info.name.substring(0, 30));
    });

    const dateStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    XLSX.writeFile(wb, `PontoTrack_Relatorio_${dateStr}.xlsx`);
  }

  // ==================== PDF ====================

  _exportPDF(records, employees) {
    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    const summary = this._processData(records, employees);

    Object.values(summary).forEach((emp, index) => {
      if (index > 0) doc.addPage();
      
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 297, 20, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.text(`CARTÃO DE PONTO: ${emp.info.name.toUpperCase()}`, 10, 13);
      
      doc.setTextColor(50);
      doc.setFontSize(10);
      let y = 30;
      
      const col = [10, 35, 65, 85, 105, 125, 145, 170, 195, 230];
      doc.setFont('helvetica', 'bold');
      const headers = ['Data', 'Dia', 'Entrada', 'Almoço', 'Retorno', 'Saída', 'Trab.', 'Extra', 'Valor Ext', 'Notas'];
      headers.forEach((h, i) => doc.text(h, col[i], y));
      
      doc.line(10, y + 2, 287, y + 2);
      y += 8;
      doc.setFont('helvetica', 'normal');

      let hasRefValues = false;

      emp.processedDays.forEach(d => {
        if (y > 180) { doc.addPage(); y = 20; }
        
        doc.setTextColor(50);
        doc.text(d.date, col[0], y);
        doc.text(d.dayOfWeek.substring(0,3), col[1], y);
        
        // Entrada - destacar se é referência
        if (d.usedRefEntry) {
          doc.setTextColor(99, 102, 241); // Roxo/azul para referência
          doc.text(`${d.entry}*`, col[2], y);
          hasRefValues = true;
        } else {
          doc.setTextColor(50);
          doc.text(d.entry, col[2], y);
        }
        
        doc.setTextColor(50);
        doc.text(d.lunchOut, col[3], y);
        doc.text(d.lunchIn, col[4], y);
        
        // Saída - destacar se é referência
        if (d.usedRefExit) {
          doc.setTextColor(99, 102, 241);
          doc.text(`${d.exit}*`, col[5], y);
          hasRefValues = true;
        } else {
          doc.setTextColor(50);
          doc.text(d.exit, col[5], y);
        }
        
        doc.setTextColor(50);
        doc.text(this._formatMinutes(d.worked), col[6], y);
        doc.text(this._formatMinutes(d.overtime), col[7], y);
        doc.text(d.overtimeValue > 0 ? `R$${d.overtimeValue.toFixed(2)}` : 'R$0.00', col[8], y);
        doc.text((d.notes || '').substring(0, 30), col[9], y);
        y += 7;
      });

      y += 10;
      doc.setFillColor(241, 245, 249);
      doc.rect(10, y, 277, 25, 'F');
      doc.setTextColor(50);
      doc.setFont('helvetica', 'bold');
      doc.text(`Dias Trab: ${emp.daysWorked}`, 15, y + 10);
      doc.text(`Horas: ${this._formatMinutes(emp.totalWorked)}`, 60, y + 10);
      doc.text(`Extras: ${this._formatMinutes(emp.totalOvertime)}`, 105, y + 10);
      doc.text(`Valor Extra: R$ ${emp.totalOvertimeValue.toFixed(2)}`, 150, y + 10);
      doc.text(`Média Diária: ${this._formatMinutes(emp.daysWorked ? Math.round(emp.totalWorked / emp.daysWorked) : 0)}`, 220, y + 10);

      // Rodapé com legenda se houve valores de referência
      if (hasRefValues) {
        y += 30;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(99, 102, 241);
        doc.text('* Horário de referência utilizado (Seg-Sex: 07:30/17:30 | Sáb: 07:30/11:30) por ausência de registro.', 10, y);
      }
    });

    doc.save(`pontotrack_relatorio_${Date.now()}.pdf`);
  }

  // ==================== RELATÓRIO MENSAL COMPLETO ====================

  _buildMonthCalendar(year, month, records, empInfo) {
    const empName    = (empInfo?.name || '').toLowerCase();
    const isSpecialEmp = empName.includes('raimundo') || empName.includes('joao adelmo') || empName.includes('joão adelmo');
    const DAY_NAMES  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

    const byDate = {};
    records.forEach(r => {
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(r);
    });

    const days = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const dayIndex   = new Date(year, month, d).getDay();
      const dd         = String(d).padStart(2, '0');
      const mm         = String(month + 1).padStart(2, '0');
      const dateStr    = `${dd}/${mm}/${year}`;
      const dayRecs    = byDate[dateStr] || [];
      const isHoliday  = this._isNationalHoliday(dateStr);
      const hasRecords = dayRecs.length > 0;

      let entry1='', exit1='', entry2='', exit2='';
      let usedRefEntry=false, usedRefExit=false;
      let workedMin=0, expectedMin=0;
      let heMin50=0, heMin100=0, atrasoMin=0, faltaMin=0;
      let occurrence='', isDSR=false, isFalta=false;

      // ── Jornada esperada e ocorrência base ──
      if (isHoliday) {
        occurrence = this._getHolidayName(dateStr);
        // expectedMin = 0
      } else if (dayIndex === 0) {          // Domingo
        isDSR      = !hasRecords;
        occurrence = hasRecords ? '' : 'DSR';
        // expectedMin = 0
      } else if (dayIndex === 6) {          // Sábado
        if (isSpecialEmp) {
          isDSR      = !hasRecords;
          occurrence = hasRecords ? '' : 'DSR';
          // expectedMin = 0
        } else {
          expectedMin = 4 * 60;
          if (!hasRecords) { isFalta = true; occurrence = 'FALTA'; }
        }
      } else {                              // Segunda a Sexta
        expectedMin = 8 * 60;
        if (!hasRecords) { isFalta = true; occurrence = 'FALTA'; }
      }

      if (!hasRecords) {
        if (isFalta) faltaMin = expectedMin;
      } else {
        const stats  = this._calculateDayStats(dayRecs, empInfo);
        workedMin    = stats.worked;
        expectedMin  = stats.expectedMin;   // valor preciso do calculador (já considera feriados)

        entry1       = stats.entry   !== '--:--' ? stats.entry   : '';
        exit1        = stats.lunchOut!== '--:--' ? stats.lunchOut: '';
        entry2       = stats.lunchIn !== '--:--' ? stats.lunchIn : '';
        exit2        = stats.exit    !== '--:--' ? stats.exit    : '';
        usedRefEntry = stats.usedRefEntry;
        usedRefExit  = stats.usedRefExit;

        if (workedMin > expectedMin) {
          const he = workedMin - expectedMin;
          if (dayIndex === 0 || isHoliday) heMin100 = he;
          else                             heMin50  = he;
        } else if (workedMin < expectedMin && expectedMin > 0) {
          atrasoMin = expectedMin - workedMin;
        }

        if (isHoliday) occurrence = this._getHolidayName(dateStr);
      }

      days.push({
        dateStr, dateDisplay: `${dd}/${mm}`, dayIndex,
        dayName: DAY_NAMES[dayIndex],
        entry1, exit1, entry2, exit2, usedRefEntry, usedRefExit,
        workedMin, expectedMin, heMin50, heMin100, atrasoMin, faltaMin,
        occurrence, isHoliday, isDSR, isFalta, hasRecords
      });
    }
    return days;
  }

  async generateMonthReport(format, filters) {
    const { employeeId, year, month } = filters;
    let allRecords   = await window.ptDB.getAll('records');
    let allEmployees = await window.ptDB.getAll('employees');

    allEmployees = allEmployees.filter(e => e.status !== 'inactive');
    if (employeeId && employeeId !== 'all') {
      allEmployees = allEmployees.filter(e => e.id === employeeId);
    }
    if (!allEmployees.length) return;

    const startTs = new Date(year, month, 1).getTime();
    const endTs   = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
    const filtered = allRecords.filter(r => {
      const ts = new Date(r.timestamp).getTime();
      return ts >= startTs && ts <= endTs;
    });

    if (format === 'excel' || format === 'both') this._exportExcelDetailed(filtered, allEmployees, year, month);
    if (format === 'pdf'   || format === 'both') this._exportPDFDetailed(filtered, allEmployees, year, month);
  }

  _exportExcelDetailed(records, employees, year, month) {
    if (typeof XLSX === 'undefined') { alert('Biblioteca XLSX não disponível.'); return; }

    const MN = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const monthLabel = `${MN[month]}/${year}`;
    const brd = this._getBorder();
    const wb  = XLSX.utils.book_new();
    const summaryRows = [];

    const byEmp = {};
    records.forEach(r => {
      if (!byEmp[r.employeeId]) byEmp[r.employeeId] = [];
      byEmp[r.employeeId].push(r);
    });

    employees.forEach(emp => {
      const calendar = this._buildMonthCalendar(year, month, byEmp[emp.id] || [], emp);
      const ws = {}, mgs = [];
      let row = 0;

      // ── helpers ──
      const set = (r, c, v, s) => {
        ws[XLSX.utils.encode_cell({r, c})] = { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s };
      };
      const mkF = (bold, sz, rgb, italic) => ({ bold:!!bold, sz:sz||10, name:'Arial', color:{rgb:rgb||'1E293B'}, italic:!!italic });
      const mkB = rgb => ({ fgColor:{rgb} });
      const mkA = (h, wrap) => ({ horizontal:h||'center', vertical:'center', wrapText:!!wrap });

      // ── shared styles ──
      const S = {
        title:  { font:mkF(1,13,'FFFFFF'),  fill:mkB('0F172A'), alignment:mkA('center'),     border:brd },
        lbl:    { font:mkF(1,10,'1E293B'),  fill:mkB('E2E8F0'), alignment:mkA('right'),      border:brd },
        val:    { font:mkF(0,10,'1E293B'),  fill:mkB('FFFFFF'), alignment:mkA('left'),       border:brd },
        hdr:    { font:mkF(1,10,'FFFFFF'),  fill:mkB('1565C0'), alignment:mkA('center',1),  border:brd },
        total:  { font:mkF(1,10,'0D47A1'),  fill:mkB('BBDEFB'), alignment:mkA('center'),     border:brd },
        totalL: { font:mkF(1,10,'0D47A1'),  fill:mkB('BBDEFB'), alignment:mkA('left'),       border:brd },
        legend: { font:mkF(0,8,'64748B',1), fill:mkB('F8FAFC'), alignment:mkA('left'),       border:brd },
        row: (bg, bold, rgb, italic) => ({
          font: mkF(bold,10,rgb||'1E293B',italic), fill:mkB(bg), alignment:mkA('center'), border:brd
        }),
      };

      // ── Row 0: Título ──
      for (let c=0; c<13; c++) set(row, c, c===0?'PontoTrack — Cartão de Ponto Mensal':'', S.title);
      mgs.push({ s:{r:0,c:0}, e:{r:0,c:12} });
      row++;

      // ── Rows 1–6: Info do funcionário ──
      [
        ['Empresa:',           'PontoTrack'],
        ['Funcionário:',       emp.name  || ''],
        ['PIS/PASEP:',         '—'],
        ['Matrícula:',         emp.id    || ''],
        ['Período:',           monthLabel],
        ['Jornada Contratual:','Seg–Sex: 07:30–17:30 (1h almoço) | Sáb: 07:30–11:30'],
      ].forEach(([lbl, val]) => {
        set(row, 0, lbl, S.lbl);
        set(row, 1, val, S.val);
        for (let c=2; c<13; c++) set(row, c, '', S.val);
        mgs.push({ s:{r:row,c:1}, e:{r:row,c:12} });
        row++;
      });

      // ── Row 7: Espaçador ──
      for (let c=0; c<13; c++) set(row, c, '', { font:mkF(0,3), fill:mkB('F0F4F8'), border:brd });
      row++;

      // ── Row 8: Cabeçalho das colunas ──
      ['Data','Dia','Entrada 1','Saída 1','Entrada 2','Saída 2',
       'H. Trab.','H. Esp.','HE 50%','HE 100%','Atraso','Falta','Ocorrência']
        .forEach((h, c) => set(row, c, h, S.hdr));
      const FREEZE_ROW = row + 1;
      row++;

      // ── Linhas de dados ──
      let totW=0, totE=0, tot50=0, tot100=0, totA=0, totF=0, diasTrab=0;

      calendar.forEach(day => {
        let bg;
        if      (day.isFalta)             bg = 'FFEBEE';
        else if (day.isDSR||day.dayIndex===0) bg = 'EEEEEE';
        else if (day.isHoliday)           bg = 'FEF3C7';
        else                              bg = day.dayIndex%2===0 ? 'FFFFFF' : 'F5F8FF';

        const cs  = S.row(bg);
        const csR = S.row(bg, true, 'C62828');
        const csG = S.row(bg, true, '2E7D32');
        const csI = S.row(bg, false,'6366F1', true);  // italic/blue = referência
        const fm  = v => v>0 ? this._formatMinutes(v) : '—';

        set(row,  0, day.dateDisplay,                              cs);
        set(row,  1, day.dayName,                                  cs);
        set(row,  2, day.entry1||'—',  day.usedRefEntry ? csI : cs);
        set(row,  3, day.exit1 ||'—',                              cs);
        set(row,  4, day.entry2||'—',                              cs);
        set(row,  5, day.exit2 ||'—',  day.usedRefExit  ? csI : cs);
        set(row,  6, day.workedMin  >0 ? this._formatMinutes(day.workedMin)  : '—', cs);
        set(row,  7, day.expectedMin>0 ? this._formatMinutes(day.expectedMin): '—', cs);
        set(row,  8, fm(day.heMin50),   day.heMin50  >0 ? csG : cs);
        set(row,  9, fm(day.heMin100),  day.heMin100 >0 ? csG : cs);
        set(row, 10, fm(day.atrasoMin), day.atrasoMin>0 ? csR : cs);
        set(row, 11, fm(day.faltaMin),  day.faltaMin >0 ? csR : cs);
        set(row, 12, day.occurrence||'',
          day.isHoliday ? S.row(bg,true,'92400E') : cs);

        totW+=day.workedMin; totE+=day.expectedMin;
        tot50+=day.heMin50; tot100+=day.heMin100;
        totA+=day.atrasoMin; totF+=day.faltaMin;
        if (day.hasRecords) diasTrab++;
        row++;
      });

      // ── Linha de TOTAIS ──
      const saldo    = totW - totE;
      const saldoStr = `${saldo>=0?'+':'-'}${this._formatMinutes(Math.abs(saldo))}`;
      ['TOTAIS', `${diasTrab} dias`, '', '', '', '',
       this._formatMinutes(totW), this._formatMinutes(totE),
       tot50 >0?this._formatMinutes(tot50) :'—',
       tot100>0?this._formatMinutes(tot100):'—',
       totA  >0?this._formatMinutes(totA)  :'—',
       totF  >0?this._formatMinutes(totF)  :'—',
       `Saldo: ${saldoStr}`,
      ].forEach((v, c) => set(row, c, v, c<2 ? S.totalL : S.total));
      mgs.push({ s:{r:row,c:0}, e:{r:row,c:1} });
      row++;

      // ── Legenda ──
      row++;
      set(row, 0, '* Itálico azul = horário de referência (07:30 / 17:30) aplicado por ausência de registro', S.legend);
      mgs.push({ s:{r:row,c:0}, e:{r:row,c:12} });
      row++;

      // ── Configurações da aba ──
      ws['!merges'] = mgs;
      ws['!cols']   = [10,6,10,10,10,10,11,11,10,10,10,10,22].map(w=>({wch:w}));
      ws['!ref']    = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:row-1,c:12} });
      ws['!freeze'] = { xSplit:2, ySplit:FREEZE_ROW, topLeftCell:`C${FREEZE_ROW+1}` };

      const shName = (emp.name||'Func').substring(0,28).replace(/[/\\?*[\]:]/g,'').trim() || `F${emp.id}`;
      XLSX.utils.book_append_sheet(wb, ws, shName);
      summaryRows.push({ emp, diasTrab, totW, totE, tot50, tot100, totA, totF, saldo });
    });

    // ════════════════════════════════════════════
    // ABA: Resumo Mensal
    // ════════════════════════════════════════════
    const wsR = {}, mgsR = [];
    let rRow = 0;
    const brdR = this._getBorder();
    const mkFR = (bold,sz,rgb) => ({ bold:!!bold, sz:sz||10, name:'Arial', color:{rgb:rgb||'1E293B'} });
    const mkBR = rgb => ({ fgColor:{rgb} });

    const SR = {
      title: { font:mkFR(1,13,'FFFFFF'), fill:mkBR('0F172A'), alignment:{horizontal:'center',vertical:'center'}, border:brdR },
      hdr:   { font:mkFR(1,10,'FFFFFF'), fill:mkBR('1565C0'), alignment:{horizontal:'center',vertical:'center',wrapText:true}, border:brdR },
      row:  (bg,bold,rgb) => ({ font:mkFR(bold,10,rgb||'1E293B'), fill:mkBR(bg), alignment:{horizontal:'center'}, border:brdR }),
      rowL: (bg,bold,rgb) => ({ font:mkFR(bold,10,rgb||'1E293B'), fill:mkBR(bg), alignment:{horizontal:'left'},   border:brdR }),
      total: { font:mkFR(1,10,'0D47A1'), fill:mkBR('BBDEFB'), alignment:{horizontal:'center'}, border:brdR },
    };
    const setR = (r,c,v,s) => {
      wsR[XLSX.utils.encode_cell({r,c})] = { v:v??'', t:typeof v==='number'?'n':'s', s };
    };

    // Título
    for (let c=0; c<11; c++) setR(rRow, c, c===0?`Resumo Mensal — ${monthLabel}`:'', SR.title);
    mgsR.push({ s:{r:0,c:0}, e:{r:0,c:10} });
    rRow++;

    // Cabeçalhos
    ['Matrícula','Funcionário','Cargo','Dias Trab.','Faltas',
     'H. Trab.','H. Esp.','HE 50%','HE 100%','Atrasos','Saldo']
      .forEach((h,c) => setR(rRow, c, h, SR.hdr));
    rRow++;

    let rTotDias=0,rTotW=0,rTotE=0,rTot50=0,rTot100=0,rTotA=0,rTotF=0;

    summaryRows.forEach(({emp,diasTrab,totW,totE,tot50,tot100,totA,totF,saldo},idx) => {
      const bg      = idx%2===0 ? 'FFFFFF' : 'F5F8FF';
      const cs      = SR.row(bg);
      const csR     = SR.row(bg, true, 'C62828');
      const csG     = SR.row(bg, true, '2E7D32');
      const faltaD  = totF>0 ? +(totF/(8*60)).toFixed(1) : 0;
      const saldoS  = `${saldo>=0?'+':'-'}${this._formatMinutes(Math.abs(saldo))}`;

      setR(rRow, 0,  emp.id||'',   cs);
      setR(rRow, 1,  emp.name||'', SR.rowL(bg));
      setR(rRow, 2,  emp.role||'', cs);
      setR(rRow, 3,  diasTrab,     cs);
      setR(rRow, 4,  faltaD>0 ? `${faltaD}d` : '—', faltaD>0 ? csR : cs);
      setR(rRow, 5,  this._formatMinutes(totW),  cs);
      setR(rRow, 6,  this._formatMinutes(totE),  cs);
      setR(rRow, 7,  tot50 >0?this._formatMinutes(tot50) :'—', tot50 >0?csG:cs);
      setR(rRow, 8,  tot100>0?this._formatMinutes(tot100):'—', tot100>0?csG:cs);
      setR(rRow, 9,  totA  >0?this._formatMinutes(totA)  :'—', totA  >0?csR:cs);
      setR(rRow, 10, saldoS, saldo>=0 ? csG : csR);

      rTotDias+=diasTrab; rTotW+=totW; rTotE+=totE;
      rTot50+=tot50; rTot100+=tot100; rTotA+=totA; rTotF+=totF;
      rRow++;
    });

    const rSaldo   = rTotW-rTotE;
    const rSaldoS  = `${rSaldo>=0?'+':'-'}${this._formatMinutes(Math.abs(rSaldo))}`;
    ['TOTAIS','','', rTotDias, '',
     this._formatMinutes(rTotW), this._formatMinutes(rTotE),
     rTot50 >0?this._formatMinutes(rTot50) :'—',
     rTot100>0?this._formatMinutes(rTot100):'—',
     rTotA  >0?this._formatMinutes(rTotA)  :'—',
     rSaldoS,
    ].forEach((v,c) => setR(rRow, c, v, SR.total));
    mgsR.push({ s:{r:rRow,c:0}, e:{r:rRow,c:1} });
    rRow++;

    wsR['!merges'] = mgsR;
    wsR['!cols']   = [12,22,16,10,9,11,11,10,10,10,13].map(w=>({wch:w}));
    wsR['!ref']    = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:rRow-1,c:10} });
    wsR['!freeze'] = { xSplit:2, ySplit:2, topLeftCell:'C3' };

    XLSX.utils.book_append_sheet(wb, wsR, 'Resumo Mensal');
    XLSX.writeFile(wb, `PontoTrack_${MN[month]}_${year}.xlsx`);
  }

  _exportPDFDetailed(records, employees, year, month) {
    if (typeof window.jspdf === 'undefined') { alert('Biblioteca jsPDF não disponível.'); return; }
    const { jsPDF } = window.jspdf;

    const MN = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const monthLabel = `${MN[month]}/${year}`;
    const byEmp      = {};
    records.forEach(r => {
      if (!byEmp[r.employeeId]) byEmp[r.employeeId] = [];
      byEmp[r.employeeId].push(r);
    });

    const doc    = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
    const PW     = doc.internal.pageSize.getWidth();
    const PH     = doc.internal.pageSize.getHeight();
    const ML=8, MR=8, MT=8, MB=13;
    const emitDate = new Date().toLocaleDateString('pt-BR',
      { day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit' });

    let firstEmp = true;

    employees.forEach(emp => {
      const calendar = this._buildMonthCalendar(year, month, byEmp[emp.id]||[], emp);
      if (!firstEmp) doc.addPage();
      firstEmp = false;
      let y = MT;

      // ── Barra de título ──
      doc.setFillColor(15,23,42);
      doc.rect(ML, y, PW-ML-MR, 9, 'F');
      doc.setTextColor(255,255,255);
      doc.setFontSize(12);
      doc.setFont('helvetica','bold');
      doc.text('PontoTrack — Cartão de Ponto Mensal', PW/2, y+6.3, { align:'center' });
      y += 11;

      // ── Barra de info do funcionário ──
      doc.setFillColor(226,232,240);
      doc.rect(ML, y, PW-ML-MR, 14, 'F');
      doc.setFontSize(8);
      const infoW = (PW-ML-MR) / 4;
      [
        [`Funcionário:`, emp.name||''],
        [`Matrícula:`,   emp.id||''],
        [`Cargo:`,       emp.role||''],
        [`Período:`,     monthLabel],
      ].forEach(([lbl,val], i) => {
        const ix = ML + i*infoW + 2;
        doc.setTextColor(30,41,59);
        doc.setFont('helvetica','bold');
        doc.text(lbl, ix, y+5);
        doc.setFont('helvetica','normal');
        doc.text(val, ix + doc.getTextWidth(lbl) + 1.5, y+5);
      });
      doc.setFont('helvetica','bold');
      doc.text('Jornada:', ML+2, y+11);
      doc.setFont('helvetica','normal');
      doc.text('Seg–Sex: 07:30–17:30 (1h almoço) | Sáb: 07:30–11:30', ML+2+doc.getTextWidth('Jornada:')+1.5, y+11);
      y += 17;

      // ── Tabela principal ──
      const heads = [['Data','Dia','Entrada 1','Saída 1','Entrada 2','Saída 2',
                       'H.Trab.','H.Esp.','HE 50%','HE 100%','Atraso','Falta','Ocorrência']];
      const body  = calendar.map(day => [
        day.dateDisplay, day.dayName,
        day.entry1||'—', day.exit1||'—',
        day.entry2||'—', day.exit2||'—',
        day.workedMin  >0 ? this._formatMinutes(day.workedMin)  : '—',
        day.expectedMin>0 ? this._formatMinutes(day.expectedMin): '—',
        day.heMin50  >0 ? this._formatMinutes(day.heMin50)  : '—',
        day.heMin100 >0 ? this._formatMinutes(day.heMin100) : '—',
        day.atrasoMin>0 ? this._formatMinutes(day.atrasoMin): '—',
        day.faltaMin >0 ? this._formatMinutes(day.faltaMin) : '—',
        day.occurrence||'',
      ]);

      doc.autoTable({
        startY: y,
        head:   heads,
        body:   body,
        margin: { left:ML, right:MR },
        theme:  'grid',
        headStyles: {
          fillColor:[21,101,192], textColor:255,
          fontStyle:'bold', fontSize:7.5, halign:'center', cellPadding:1.5
        },
        bodyStyles: { fontSize:7.5, cellPadding:1.5, halign:'center', textColor:[30,41,59] },
        alternateRowStyles: { fillColor:[245,248,255] },
        columnStyles: {
          0:{cellWidth:11}, 1:{cellWidth:8},
          2:{cellWidth:15}, 3:{cellWidth:15},
          4:{cellWidth:15}, 5:{cellWidth:15},
          6:{cellWidth:14}, 7:{cellWidth:14},
          8:{cellWidth:13}, 9:{cellWidth:13},
          10:{cellWidth:12}, 11:{cellWidth:12},
          12:{halign:'left'}
        },
        didParseCell: data => {
          if (data.section !== 'body') return;
          const d = calendar[data.row.index];
          if (!d) return;
          if      (d.isFalta)  data.cell.styles.fillColor = [255,235,238];
          else if (d.isDSR||d.dayIndex===0) data.cell.styles.fillColor = [238,238,238];
          else if (d.isHoliday)data.cell.styles.fillColor = [254,243,199];
          const c = data.column.index;
          if (c===10 && d.atrasoMin>0){ data.cell.styles.textColor=[198,40,40];  data.cell.styles.fontStyle='bold'; }
          if (c===11 && d.faltaMin >0){ data.cell.styles.textColor=[198,40,40];  data.cell.styles.fontStyle='bold'; }
          if (c===8  && d.heMin50  >0){ data.cell.styles.textColor=[46,125,50];  data.cell.styles.fontStyle='bold'; }
          if (c===9  && d.heMin100 >0){ data.cell.styles.textColor=[46,125,50];  data.cell.styles.fontStyle='bold'; }
          if (c===2  && d.usedRefEntry){ data.cell.styles.textColor=[99,102,241]; data.cell.styles.fontStyle='italic'; }
          if (c===5  && d.usedRefExit) { data.cell.styles.textColor=[99,102,241]; data.cell.styles.fontStyle='italic'; }
        },
      });

      // ── Barra de totais ──
      let totW=0,totE=0,tot50=0,tot100=0,totA=0,totF=0,diasTrab=0;
      calendar.forEach(d => {
        totW+=d.workedMin; totE+=d.expectedMin;
        tot50+=d.heMin50;  tot100+=d.heMin100;
        totA+=d.atrasoMin; totF+=d.faltaMin;
        if (d.hasRecords) diasTrab++;
      });
      const saldo    = totW-totE;
      const saldoStr = `${saldo>=0?'+':'-'}${this._formatMinutes(Math.abs(saldo))}`;

      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 2,
        body: [[
          `Dias Trab.: ${diasTrab}`,
          `H. Trabalhadas: ${this._formatMinutes(totW)}`,
          `H. Esperadas: ${this._formatMinutes(totE)}`,
          `HE 50%: ${tot50>0?this._formatMinutes(tot50):'—'}`,
          `HE 100%: ${tot100>0?this._formatMinutes(tot100):'—'}`,
          `Atrasos: ${totA>0?this._formatMinutes(totA):'—'}`,
          `Saldo: ${saldoStr}`,
        ]],
        margin:     { left:ML, right:MR },
        theme:      'grid',
        bodyStyles: { fillColor:[187,222,251], textColor:[13,71,161], fontStyle:'bold', fontSize:8, halign:'center', cellPadding:2 },
      });

      // ── Bloco de assinaturas ──
      const afterTable = doc.lastAutoTable.finalY + 8;
      const sigH       = 36;
      const sy = (afterTable + sigH > PH - MB) ? (doc.addPage(), MT) : afterTable;

      doc.setFontSize(7.5);
      doc.setFont('helvetica','italic');
      doc.setTextColor(100,116,139);
      doc.text('* Horários em itálico azul = horário de referência aplicado por ausência de registro', ML, sy);

      const sigY   = sy + 6;
      const sigW   = (PW - ML - MR - 20) / 3;
      const sigGap = 10;
      const sigXs  = [ML, ML+sigW+sigGap, ML+(sigW+sigGap)*2];
      const sigLbls = ['Assinatura do Funcionário','Assinatura do Responsável / Gestor','Assinatura da Empresa / RH'];

      sigXs.forEach((sx, i) => {
        doc.setDrawColor(148,163,184);
        doc.setLineWidth(0.3);
        doc.line(sx, sigY+14, sx+sigW, sigY+14);
        doc.setFont('helvetica','normal');
        doc.setFontSize(7.5);
        doc.setTextColor(30,41,59);
        doc.text(sigLbls[i], sx+sigW/2, sigY+18, { align:'center' });
        if (i===0 && emp.name) {
          doc.setFontSize(7);
          doc.setTextColor(100,116,139);
          doc.text(emp.name, sx+sigW/2, sigY+23, { align:'center' });
        }
      });

      doc.setFont('helvetica','normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100,116,139);
      doc.text(`Data de emissão: ${emitDate}`, ML, sigY+30);
      doc.text(`Período: ${monthLabel}`, PW/2, sigY+30, { align:'center' });
      doc.text(`Matrícula: ${emp.id||''}`, PW-MR, sigY+30, { align:'right' });
    });

    // ── Rodapé em todas as páginas ──
    const totalPgs = doc.internal.getNumberOfPages();
    for (let p=1; p<=totalPgs; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setFont('helvetica','normal');
      doc.setTextColor(148,163,184);
      doc.text(`Página ${p} de ${totalPgs}`,                  PW-MR, PH-4, { align:'right' });
      doc.text(`Emitido em: ${emitDate}`,                     ML,    PH-4);
      doc.text('PontoTrack — Sistema de Controle de Ponto', PW/2,  PH-4, { align:'center' });
    }

    doc.save(`PontoTrack_PDF_${MN[month]}_${year}.pdf`);
  }
}

window.reportsManager = new ReportsManager();
