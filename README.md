# PontoTrack - Sistema de Ponto Eletrônico PWA (Offline-First)

Este projeto é um aplicativo web progressivo (PWA) de controle de ponto eletrônico desenvolvido para uso em campo (como obras e zonas rurais). Uma de suas principais características é ser **Offline-First**, ou seja, funciona 100% de forma autônoma sem internet e sincroniza os dados com a nuvem (Firebase) assim que a conexão é restabelecida.

---

## 🚀 Principais Funcionalidades

1. **Modo Offline e Sincronização Inteligente**
   - Utiliza `IndexedDB` para armazenar registros, funcionários e configurações localmente.
   - O `Service Worker (sw.js)` atua como proxy, garantindo o carregamento instantâneo da interface, mesmo sem rede (Cache-First para arquivos estáticos).
   - O módulo `sync.js` detecta automaticamente a reconexão (eventos `online/offline`) e despacha uma fila inteligente contendo todos os registros pendentes, resolvendo conflitos antes de enviar ao Firebase.

2. **Registro de Ponto Completo**
   - Suporta quatro tipos de marcação de ponto diário: **Entrada**, **Pausa**, **Almoço** e **Saída**, seguidas por suas respectivas marcações de retorno (`break_end` e `lunch_end`).
   - Todos os pontos marcam precisamente a data e hora (`HH:MM`).
   - O usuário pode adicionar uma **Observação Justificativa** opcional para cada ponto batido (ex: *Fui mais cedo comprar material*).

3. **Geolocalização (GPS) e Tolerância de Obras**
   - Cada marcação pode capturar compulsoriamente (ou opcionalmente) as coordenadas de Latitude e Longitude, incluindo a precisão do GPS (`accuracy`).
   - Em caso de seleção de Obra/Fazenda vinculada (em `geo.js`), calcula-se através da fórmula de *Haversine* a distância percorrida pelo funcionário e impede falsificações se estiver a quilômetros de distância além do "Raio de Tolerância" configurado para a obra.

4. **Biometria Facilitada (Foto via Câmera Frontal)**
   - Ao bater o ponto, o sistema aciona a câmera (via WebRTC/`getUserMedia`).
   - Permite pular fotos (de acordo com as permissões do administrador).

5. **Painel do Administrador (`Admin`)**
   - Gráficos de presença ao vivo.
   - Visão em mapa (Leaflet) para checar de qual ponto do globo terrestre a marcação foi enviada.
   - Cadastro, Gestão e Inativação de Funcionários.
   - Cadastro e delimitação de Obras e Fazendas (com captura de GPS automática).
   - Configurações do App (horário padrão de entrada e saída: ex: `07:30 às 17:30`, horas da jornada diária).

6. **Relatórios Gerenciais (Excel e PDF)**
   - O objeto `ReportsManager` permite a exportação detalhada ou resumida de informações filtráveis por data ou funcionário.
   - O cálculo automatizado conta além das horas totais trabalhadas, as "Horas Esperadas na Base", que é o parâmetro legal de horas exigidas (descontando domingo, 8h via dias úteis, 4h via sábado).
   - Calcula diretamente o saldo final positivo ou negativo em planilha mostrando rapidamente o cenário de "Horas Extras".

7. **Banco de Horas Automático em Tela**
   - O próprio funcionário tem acesso ao seu painel "Banco de Horas" (+/-), calculado até o instante presente do mês, incentivando a transparência na relação de trabalho.
   - Todo o sistema de matemática e deduções de `_calcExpectedMonthMinutesUntilToday` retira com precisão os minutos passados nas funções de Pausa Comum ou Pausa para o Almoço.

---

## 🛠️ Tecnologias Utilizadas

- **HTML5 e Vanilla JavaScript (ES6+)**: Sem frameworks pesados (React, Vue) para maximizar compatibilidade em navegadores antigos (móveis simples).
- **CSS3 / Variáveis Nativas**: Sistema de temas (Primary Dark Theme) ajustável de fácil manutenção e botões "Fat fingers" (tamanho exagerado para uso com luvas de EPI no campo).
- **IndexedDB (`idb`) & LocalStorage**: Bancos de dados rodando direto no navegador (no bolso do funcionário).
- **Firebase / Firestore**: BaaS de nuvem para hospedar globalmente o Data Lake.
- **Leaflet (`leaflet.js`)**: Visualização de Mapas open source.
- **jsPDF & SheetJS (XLSX)**: Para a geração on-the-fly de documentos.

---

## ⚙️ Documentação para Manutenções Futuras

### 1. Sistema de "Break" (Pausas e Almoço)
Se quiser adicionar novos tipos de pausa no futuro:
- Altere `index.html` (para os novos botões HTML e CSS).
- Mude o método de visualizações `startRegistration(type)` dentro do arquivo **`js/app.js`**. Adicione as lógicas condicionais no `typeNames`.
- **Cálculo de Banco de Horas:** Caso seja um novo intervalo descontável (que não remunera o trabalhador), adicione o abatimento nos métodos de array reduce `_calcWorkMinutes(records)` na raiz do App ou no sumário PDF em `js/reports.js`.

### 2. Service Worker (O Famoso Problema de "Cache Preso")
- O arquivo que controla que o sistema funcione em locais rurais sem celular é o **`sw.js`**.
- Sempre que você fizer alterações nos arquivos fontes JavaScript (`*.js`, `*.html` ou `.css`), lembre-se de ir no `sw.js` e alterar as variáveis `CACHE_NAME`, `STATIC_CACHE` e `DYNAMIC_CACHE` de **v2.X** para **v2.(X+1)** ou v3.0 etc.
- Caso não mude o nome da versão, os navegadores clientes tentarão recuperar todo o HTML da gaveta cache deles para economizar dados, e o usuário nunca verá sua atualização!

### 3. As Configurações do Firebase
Para trocar o Banco de Dados Firestore de conta ou de projeto caso atinjam os limites gratuitos do atual:
Vá até a função assíncrona raiz **`init()`** no topo de **`js/app.js`**, e localize as linhas de configuração:

```javascript
const firebaseConfig = {
  apiKey: "Sua_Key_AQUI",
  authDomain: "pontotrack-novo.firebaseapp.com",
  projectId: "pontotrack-novo",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
firebase.initializeApp(firebaseConfig);
firestore = firebase.firestore();
```

### 4. Credenciais de Administrador Padrão (Fixadas)
Atualmente está injetado nativamente no frontend (em **`js/app.js`** > `handleLogin()`) as credenciais fixas para a visualização macro:
- **Login:** `admin`
- **Senha:** `admin123`

Para trocar para algo mais seguro, mude a cláusula "If/Else" contendo `if (email === 'admin' && password === 'admin123')` neste arquivo.

### 5. Configurar Atualização e Deploy
Toda a plataforma foi hospedada como um site estático no **Netlify** (graças ao arquivo em branco `_redirects` contendo `/* /index.html 200` que previne erros 404 em PWA).
1. Faça os ajustes de código.
2. Salve, suba a versão do sistema em `sw.js`.
3. Arraste e solte essa pasta total (`field-time-tracker`) na aba "Deploys" de seu Dashboard logado do Netlify. Em segundos estará 100% atual e em todos os celulares.
