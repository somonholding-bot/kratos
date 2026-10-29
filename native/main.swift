// Kratos para macOS: ventana propia con el panel, icono en la barra de menú y escucha
// continua de la palabra «Kratos». Todo el audio va solo al servidor local (127.0.0.1).
import AppKit
import AVFoundation
import WebKit

let ROOT = NSHomeDirectory() + "/Jarvis"
let BASE = URL(string: "http://127.0.0.1:7420")!

func sessionToken() -> String? {
  (try? String(contentsOfFile: ROOT + "/.jarvis/session-token", encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
}

// Registro mínimo de la app (sin audio ni textos del usuario)
func appLog(_ msg: String) {
  let line = "\(ISO8601DateFormatter().string(from: Date())) \(msg)\n"
  let path = ROOT + "/.jarvis/logs/app.log"
  if let h = FileHandle(forWritingAtPath: path) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
}

// MARK: - API local

enum API {
  static func request(_ path: String, method: String = "GET", body: Data? = nil, type: String = "application/json") -> URLRequest {
    var r = URLRequest(url: URL(string: path, relativeTo: BASE)!)
    r.httpMethod = method
    r.httpBody = body
    r.timeoutInterval = 60
    r.httpShouldHandleCookies = false
    if let t = sessionToken() { r.setValue("jarvis=\(t)", forHTTPHeaderField: "Cookie") }
    if body != nil { r.setValue(type, forHTTPHeaderField: "Content-Type") }
    return r
  }

  static func send(_ r: URLRequest, _ done: @escaping ([String: Any]?) -> Void) {
    URLSession.shared.dataTask(with: r) { data, _, _ in
      let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      DispatchQueue.main.async { done(obj ?? nil) }
    }.resume()
  }

  static func post(_ path: String, _ obj: [String: Any], _ done: @escaping ([String: Any]?) -> Void = { _ in }) {
    send(request(path, method: "POST", body: try? JSONSerialization.data(withJSONObject: obj)), done)
  }

  // Audio WAV de la voz natural (nil si no está disponible)
  static func speech(_ text: String, _ done: @escaping (Data?) -> Void) {
    var r = request("/api/voice/speak", method: "POST", body: try? JSONSerialization.data(withJSONObject: ["text": text]))
    r.timeoutInterval = 30
    URLSession.shared.dataTask(with: r) { data, resp, _ in
      let ok = (resp as? HTTPURLResponse)?.statusCode == 200 && (resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") == "audio/wav"
      DispatchQueue.main.async { done(ok ? data : nil) }
    }.resume()
  }

  static func healthy(_ done: @escaping (Bool) -> Void) {
    var r = URLRequest(url: BASE.appendingPathComponent("api/health"))
    r.timeoutInterval = 2
    URLSession.shared.dataTask(with: r) { _, resp, _ in
      DispatchQueue.main.async { done((resp as? HTTPURLResponse)?.statusCode == 200) }
    }.resume()
  }
}

// MARK: - Voz de respuesta (voces locales de macOS)

final class Speaker: NSObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
  private let synth = AVSpeechSynthesizer()
  private var player: AVAudioPlayer?
  private var meter: Timer?
  private var loading = false
  private var token = 0
  private var lastPower: Float = -60
  private var done: (() -> Void)?
  var onWord: (() -> Void)?   // una palabra pronunciada: pulso real para la escena
  var isSpeaking: Bool { loading || synth.isSpeaking || (player?.isPlaying ?? false) }

  override init() { super.init(); synth.delegate = self }

  // Voz natural local (Piper, servidor en 127.0.0.1); si no está disponible, la voz del sistema.
  func say(_ text: String, done: (() -> Void)? = nil) {
    stop()
    self.done = done
    token += 1; let my = token
    loading = true
    API.speech(text) { [weak self] data in
      guard let self, my == self.token else { return }
      self.loading = false
      if let data, let p = try? AVAudioPlayer(data: data) {
        self.player = p; p.delegate = self; p.isMeteringEnabled = true; p.volume = 0; p.play(); p.setVolume(1, fadeDuration: 0.06)
        self.meter = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) { [weak self] _ in self?.pulse() }
      } else {
        self.systemVoice(text)
      }
    }
  }

  private func pulse() {
    guard let p = player, p.isPlaying else { return }
    p.updateMeters()
    let pw = p.averagePower(forChannel: 0)
    if pw > -30 && pw - lastPower > 4 { onWord?() }   // golpe de sílaba: la escena late con la voz real
    lastPower = pw
  }

  private func systemVoice(_ text: String) {
    let clean = text.replacingOccurrences(of: "[¿¡*_#`]", with: "", options: .regularExpression)
    let u = AVSpeechUtterance(string: clean)
    u.voice = Speaker.voice
    u.rate = AVSpeechUtteranceDefaultSpeechRate * 1.04
    u.pitchMultiplier = 1.03
    synth.speak(u)
  }

  func stop() {
    token += 1
    let interrupted = loading || (player?.isPlaying ?? false)
    loading = false
    if player?.isPlaying ?? false { player?.stop() }
    player = nil
    if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }   // didCancel cierra el turno
    if interrupted { finish() }                                   // quien esperaba el final puede seguir escuchando
  }

  // Respaldo: voz masculina de mejor calidad instalada en macOS
  static let preferred = ["Juan", "Jorge", "Diego", "Carlos", "Andrés", "Pablo"]
  static let voice: AVSpeechSynthesisVoice? = {
    let es = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("es") && !$0.identifier.contains("eloquence") }
    func rank(_ v: AVSpeechSynthesisVoice) -> Int {
      let male = preferred.firstIndex { v.name.hasPrefix($0) }
      return v.quality.rawValue * 100 + (male.map { 50 - $0 } ?? 0) + (v.language == "es-MX" ? 1 : 0)
    }
    return es.max { rank($0) < rank($1) }
  }()

  private func finish() { meter?.invalidate(); meter = nil; let d = done; done = nil; d?() }
  func audioPlayerDidFinishPlaying(_ p: AVAudioPlayer, successfully ok: Bool) { player = nil; finish() }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { finish() }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { finish() }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeakRangeOfSpeechString r: NSRange, utterance u: AVSpeechUtterance) {
    DispatchQueue.main.async { self.onWord?() }
  }
}

// MARK: - Escucha continua de «Kratos»

final class WakeListener {
  enum State: String {
    case off = "Escucha apagada", denied = "Sin permiso de micrófono", listening = "Di «Kratos»",
         hearing = "Oyendo…", processing = "Procesando…", followUp = "Te escucho…", speaking = "Respondiendo", error = "Error de audio"
  }

  var onState: ((State, String?) -> Void)?
  var onLevel: ((Float) -> Void)?          // nivel del micrófono, solo mientras te escucha tras despertar
  private var lastLevelAt = Date.distantPast
  private(set) var state: State = .off
  var enabled = UserDefaults.standard.object(forKey: "wakeEnabled") as? Bool ?? true {
    didSet { UserDefaults.standard.set(enabled, forKey: "wakeEnabled"); enabled ? start() : stop() }
  }
  var pausedByPanel = false { didSet { if pausedByPanel { resetSegment() } } }
  let speaker = Speaker()

  private let engine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
  private let q = DispatchQueue(label: "kratos.vad")
  private let frame = 320 // 20 ms
  private var pending: [Float] = []
  private var preroll: [[Float]] = []
  private var segment: [Float] = []
  private var inSpeech = false, loud = 0, quiet = 0
  private var floor: Float = 0.004
  private var busy = false
  private var followUpUntil: Date?
  private var lastMention: Date?

  // Ajustes (configurables desde el panel)
  var wakeWindow: Double { UserDefaults.standard.object(forKey: "wakeWindow") as? Double ?? 3.0 }      // s entre «Kratos» y «Kratos»
  var followUpSeconds: Double { UserDefaults.standard.object(forKey: "followUp") as? Double ?? 60.0 }  // ventana sin volver a decir «Kratos» (se renueva en cada respuesta)
  var sensitivity: Double { UserDefaults.standard.object(forKey: "sensitivity") as? Double ?? 0.5 }    // 0 = poco sensible, 1 = muy sensible

  private func set(_ s: State, _ msg: String? = nil) {
    DispatchQueue.main.async { self.state = s; self.onState?(s, msg) }
  }

  func bootstrap() {
    NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
      guard let self, self.enabled else { return }
      self.stop(); self.start() // cambió el micrófono: reiniciar
    }
    if enabled { start() } else { set(.off) }
  }

  // Cuando vence la ventana de conversación, vuelve a pedir «Kratos» (y el universo entra en reposo)
  private var expiry: Timer?
  func startExpiry() {
    expiry?.invalidate()
    expiry = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      guard let self, let until = self.followUpUntil, until <= Date(), !self.busy, !self.speaker.isSpeaking else { return }
      self.followUpUntil = nil
      if self.state == .followUp { self.set(self.enabled ? .listening : .off) }
    }
  }

  func start() {
    startExpiry()
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: break
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .audio) { ok in DispatchQueue.main.async { ok ? self.start() : self.set(.denied) } }
      return
    default: set(.denied); return
    }
    guard !engine.isRunning else { return }
    let input = engine.inputNode
    let fmt = input.outputFormat(forBus: 0)
    guard fmt.sampleRate > 0, let conv = AVAudioConverter(from: fmt, to: target) else { set(.error, "No hay micrófono disponible"); return }
    converter = conv
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 2048, format: fmt) { [weak self] buf, _ in self?.ingest(buf) }
    do { try engine.start(); set(.listening) } catch { set(.error, error.localizedDescription) }
  }

  func stop() {
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    q.async { self.resetSegment() }
    set(.off)
  }

  private func resetSegment() { inSpeech = false; segment = []; preroll = []; loud = 0; quiet = 0 }

  private func ingest(_ buf: AVAudioPCMBuffer) {
    guard let conv = converter else { return }
    let cap = AVAudioFrameCount(Double(buf.frameLength) * 16000 / buf.format.sampleRate) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: cap) else { return }
    var fed = false
    var err: NSError?
    conv.convert(to: out, error: &err) { _, status in
      if fed { status.pointee = .noDataNow; return nil }
      fed = true; status.pointee = .haveData; return buf
    }
    guard err == nil, let ch = out.floatChannelData else { return }
    let samples = Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
    q.async { self.process(samples) }
  }

  // Detector de voz por energía con umbral adaptativo al ruido de la sala.
  private func process(_ samples: [Float]) {
    // Nunca escuchar mientras Kratos habla, procesa o el panel usa «pulsar para hablar».
    if speaker.isSpeaking || pausedByPanel || !enabled { pending = []; if inSpeech { resetSegment() }; return }
    pending += samples
    while pending.count >= frame {
      let f = Array(pending.prefix(frame)); pending.removeFirst(frame)
      var sum: Float = 0; for s in f { sum += s * s }
      let rms = (sum / Float(frame)).squareRoot()
      if (followUpUntil ?? .distantPast) > Date(), Date().timeIntervalSince(lastLevelAt) > 0.05 {
        lastLevelAt = Date(); let v = rms; DispatchQueue.main.async { self.onLevel?(v) }
      }
      let k = Float(5.0 - 3.0 * sensitivity)              // 5× (poco) … 2× (mucho) el ruido de fondo
      let thr = max(Float(0.02 - 0.014 * sensitivity), floor * k)
      if !inSpeech {
        preroll.append(f); if preroll.count > 15 { preroll.removeFirst() }
        floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.997 + rms * 0.003
        if rms > thr { loud += 1 } else { loud = 0 }
        if loud >= 4 {
          inSpeech = true; quiet = 0
          segment = preroll.flatMap { $0 }; preroll = []
          if !busy { set(.hearing) }
        }
      } else {
        segment += f
        quiet = rms > thr * 0.7 ? 0 : quiet + 1
        if quiet >= 30 || segment.count >= 16000 * 8 { endSegment() }
      }
    }
  }

  private var queued: [Float]?
  private func endSegment() {
    let samples = segment
    resetSegment()
    if busy { queued = samples; return }   // se está procesando otro: este va después, no se pierde
    submit(samples)
  }

  private func submit(_ samples: [Float]) {
    let follow = (followUpUntil ?? .distantPast) > Date()
    if samples.count < 16000 * 35 / 100 { set(follow ? .followUp : .listening); return }
    busy = true
    set(.processing)
    let path = follow ? "/api/voice/transcribe" : "/api/voice/transcribe?mode=wake"
    API.send(API.request(path, method: "POST", body: WakeListener.wav(samples), type: "audio/wav")) { [weak self] r in
      guard let self else { return }
      if follow {
        self.followUpUntil = nil
        if let r, r["ok"] as? Bool == true, let text = r["text"] as? String { self.handle(text, metricId: r["metricId"]) }
        else { self.resume() }
        return
      }
      let mentions = r?["mentions"] as? Int ?? 0
      let paired = mentions >= 1 && (self.lastMention.map { Date().timeIntervalSince($0) <= self.wakeWindow } ?? false)
      guard let r, r["wake"] as? Bool == true || paired else {
        if mentions >= 1 { self.lastMention = Date() } // primera de «Kratos, Kratos»: esperar la segunda
        self.resume(); return
      }
      self.lastMention = nil
      NotificationCenter.default.post(name: .kratosWoke, object: nil)
      let command = (r["command"] as? String) ?? ""
      if command.isEmpty {
        self.set(.speaking)
        self.speaker.say((r["greeting"] as? String) ?? "¿Sí?") {
          self.followUpUntil = Date().addingTimeInterval(self.followUpSeconds)
          self.q.asyncAfter(deadline: .now() + 0.3) { self.busy = false; self.queued = nil; self.set(.followUp) }
        }
      } else {
        self.handle(command, metricId: r["metricId"])
      }
    }
  }

  private func handle(_ text: String, metricId: Any?) {
    let t0 = Date()
    API.post("/api/chat", ["text": text, "channel": "voz"]) { [weak self] reply in
      guard let self else { return }
      self.followUpUntil = Date().addingTimeInterval(self.followUpSeconds)   // la conversación sigue abierta
      let thinkMs = Int(Date().timeIntervalSince(t0) * 1000)
      if let id = metricId { API.post("/api/voice/latency", ["metricId": id, "thinkMs": thinkMs]) }
      NotificationCenter.default.post(name: .kratosReplied, object: reply?["action"] as? String)
      guard let spoken = reply?["spoken"] as? String else { self.resume(); return }
      self.set(.speaking)
      self.speaker.say(spoken) { self.resume() }
    }
  }

  private func resume() {
    // Pequeña pausa para que la cola de su propia voz no entre por el micrófono.
    q.asyncAfter(deadline: .now() + 0.7) {
      self.busy = false; self.pending = []
      if let next = self.queued, !self.speaker.isSpeaking { self.queued = nil; self.submit(next); return }
      self.queued = nil
      if self.enabled, let until = self.followUpUntil, until > Date() { self.set(.followUp) }   // sigue la conversación
      else { self.followUpUntil = nil; self.set(self.enabled ? .listening : .off) }
    }
  }

  static func wav(_ s: [Float]) -> Data {
    var d = Data()
    func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
    func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
    d.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + s.count * 2)); d.append("WAVEfmt ".data(using: .ascii)!)
    u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
    d.append("data".data(using: .ascii)!); u32(UInt32(s.count * 2))
    var pcm = s.map { Int16(max(-1, min(1, $0)) * 32767).littleEndian }
    d.append(Data(bytes: &pcm, count: pcm.count * 2))
    return d
  }
}

extension Notification.Name {
  static let kratosReplied = Notification.Name("kratosReplied")
  static let kratosWoke = Notification.Name("kratosWoke")
}

// MARK: - Navegador de conexiones
// Ventana propia para que el propietario inicie sesión en sus servicios (YouTube, redes, correo, Apple, Google Play…).
// Las sesiones quedan guardadas en un almacén separado del panel. KRATOS no lee contraseñas ni controla esta ventana.

final class ConnectionsBrowser: NSObject, WKNavigationDelegate, WKUIDelegate, NSTextFieldDelegate {
  static let shared = ConnectionsBrowser()
  static let sites: [(String, String)] = [
    ("Gmail", "https://mail.google.com"), ("YouTube Studio", "https://studio.youtube.com"), ("Instagram", "https://www.instagram.com"),
    ("Facebook / Meta", "https://business.facebook.com"), ("TikTok", "https://www.tiktok.com"), ("X", "https://x.com"), ("LinkedIn", "https://www.linkedin.com"),
    ("App Store Connect", "https://appstoreconnect.apple.com"), ("Google Play Console", "https://play.google.com/console"), ("Cloudflare", "https://dash.cloudflare.com"),
    ("Namecheap", "https://ap.www.namecheap.com"), ("Vercel", "https://vercel.com/dashboard"), ("GitHub", "https://github.com"), ("Stripe", "https://dashboard.stripe.com"),
    ("Upwork", "https://www.upwork.com"), ("Fiverr", "https://www.fiverr.com"), ("Collabstr", "https://collabstr.com"),
  ]
  private var window: NSWindow?
  private var web: WKWebView!
  private let address = NSTextField()

  func show(_ url: String?) {
    if window == nil { build() }
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
    if let url, let u = URL(string: url), ["https", "http"].contains(u.scheme ?? "") { web.load(URLRequest(url: u)) }
    else if web.url == nil { web.load(URLRequest(url: URL(string: ConnectionsBrowser.sites[0].1)!)) }
  }

  private func build() {
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = WKWebsiteDataStore(forIdentifier: UUID(uuidString: "6B1E3C2A-4D5F-4A7B-9C8D-0E1F2A3B4C5D")!)   // sesiones propias y persistentes
    web = WKWebView(frame: .zero, configuration: cfg)
    web.navigationDelegate = self; web.uiDelegate = self
    web.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    let sites = NSPopUpButton(frame: .zero, pullsDown: true)
    sites.addItem(withTitle: "Servicios")
    for (name, _) in ConnectionsBrowser.sites { sites.addItem(withTitle: name) }
    sites.target = self; sites.action = #selector(pick(_:))
    let back = NSButton(title: "‹", target: web, action: #selector(WKWebView.goBack(_:)))
    let fwd = NSButton(title: "›", target: web, action: #selector(WKWebView.goForward(_:)))
    let reload = NSButton(title: "↻", target: web, action: #selector(WKWebView.reload(_:)))
    address.placeholderString = "Dirección (https://…)"; address.delegate = self; address.target = self; address.action = #selector(go)
    let bar = NSStackView(views: [back, fwd, reload, sites, address]); bar.spacing = 6; bar.edgeInsets = NSEdgeInsets(top: 6, left: 8, bottom: 6, right: 8)
    let note = NSTextField(labelWithString: "Inicia sesión aquí en lo que quieras conectar. Las sesiones se guardan solo en este Mac; KRATOS nunca ve tus contraseñas.")
    note.font = .systemFont(ofSize: 11); note.textColor = .secondaryLabelColor
    let stack = NSStackView(views: [bar, note, web]); stack.orientation = .vertical; stack.spacing = 0; stack.alignment = .leading
    note.leadingAnchor.constraint(equalTo: stack.leadingAnchor, constant: 12).isActive = true
    bar.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
    web.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
    let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
    w.title = "KRATOS · Navegador de conexiones"; w.contentView = stack; w.center(); w.isReleasedWhenClosed = false
    window = w
  }

  @objc private func pick(_ b: NSPopUpButton) {
    let i = b.indexOfSelectedItem - 1
    guard i >= 0, i < ConnectionsBrowser.sites.count else { return }
    web.load(URLRequest(url: URL(string: ConnectionsBrowser.sites[i].1)!))
  }
  @objc private func go() {
    var t = address.stringValue.trimmingCharacters(in: .whitespaces)
    if !t.contains("://") { t = "https://" + t }
    if let u = URL(string: t), ["https", "http"].contains(u.scheme ?? "") { web.load(URLRequest(url: u)) }
  }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) { address.stringValue = w.url?.absoluteString ?? ""; window?.title = "KRATOS · \(w.title ?? "Navegador de conexiones")" }
  // Ventanas emergentes de inicio de sesión (Google, Apple, Meta…): se abren en la misma vista
  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
    if a.targetFrame == nil { w.load(a.request) }
    return nil
  }
}

// MARK: - Aplicación

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var web: WKWebView!
  var status: NSStatusItem!
  let wake = WakeListener()
  var wakeItem: NSMenuItem!
  var stateItem: NSMenuItem!

  func applicationDidFinishLaunching(_ n: Notification) {
    buildMainMenu()
    buildWindow()
    buildStatusItem()
    wake.onState = { [weak self] s, msg in self?.render(s, msg) }
    wake.onLevel = { [weak self] v in self?.web.evaluateJavaScript("window.kratosMicLevel && window.kratosMicLevel(\(v))") }
    wake.speaker.onWord = { [weak self] in self?.web.evaluateJavaScript("window.kratosSpeechPulse && window.kratosSpeechPulse()") }
    NotificationCenter.default.addObserver(forName: .kratosWoke, object: nil, queue: .main) { [weak self] _ in
      self?.universeJS("window.kratosWoke && window.kratosWoke()")   // al despertar, KRATOS aparece a pantalla completa
    }
    NotificationCenter.default.addObserver(forName: .kratosReplied, object: nil, queue: .main) { [weak self] n in
      self?.web.evaluateJavaScript("window.kratosRefresh && window.kratosRefresh()")
      if (n.object as? String) == "reporte" { self?.universeJS("window.kratosReport && window.kratosReport()") }
    }
    Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.heartbeat(); self?.checkAgenda() }
    ensureService { [weak self] ok in
      guard let self else { return }
      if ok { self.loadPanel(); self.wake.bootstrap(); self.heartbeat() }
      else { self.alert("Kratos no responde", "El servicio local no arrancó. Revisa ~/Jarvis/.jarvis/logs/server.log") }
    }
    if !CommandLine.arguments.contains("--hidden") { showWindow() }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }
  // Abrir KRATOS (Dock, Spotlight) siempre lleva al universo a pantalla completa; el panel queda para Esc o el menú
  func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows: Bool) -> Bool { showWindow(); if !onUniverse { openUniverse() }; return true }
  var onUniverse: Bool { web?.url?.path.hasPrefix("/prototipo") == true && web?.url?.query?.contains("embed") != true }
  var pendingJS: [String] = []
  // Ejecuta en el universo; si estaba en el panel, primero lo abre a pantalla completa y luego lo ejecuta
  func universeJS(_ js: String) {
    if onUniverse { web.evaluateJavaScript(js); return }
    pendingJS.append(js); showWindow(); openUniverse()
  }

  func ensureService(_ done: @escaping (Bool) -> Void) {
    API.healthy { ok in
      if ok { return done(true) }
      for svc in ["server", "worker"] {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = ["kickstart", "gui/\(getuid())/com.jarvis.\(svc)"]
        try? p.run()
      }
      var tries = 0
      Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { t in
        API.healthy { ok in
          tries += 1
          if ok || tries > 20 { t.invalidate(); done(ok) }
        }
      }
    }
  }

  func buildWindow() {
    let cfg = WKWebViewConfiguration()
    cfg.userContentController.add(self, name: "kratos")
    cfg.mediaTypesRequiringUserActionForPlayback = []
    web = WKWebView(frame: .zero, configuration: cfg)
    web.uiDelegate = self
    web.navigationDelegate = self
    web.setValue(false, forKey: "drawsBackground")
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    window.title = "Kratos"
    window.titlebarAppearsTransparent = true
    window.backgroundColor = NSColor(calibratedRed: 0.016, green: 0.027, blue: 0.047, alpha: 1)
    window.appearance = NSAppearance(named: .darkAqua)
    window.contentView = web
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [.fullScreenPrimary]
    window.setFrameAutosaveName("KratosMain")
    window.center()
  }

  func loadPanel() {
    guard let token = sessionToken(),
          let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "jarvis", .value: token,
                                               .expires: Date().addingTimeInterval(30 * 86400)]) else { return }
    web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak self] in
      self?.openUniverse()
    }
  }

  // Modo inmersivo: el universo de KRATOS a pantalla completa. Esc o «Salir» llevan al panel de detalles.
  func openUniverse() {
    web.load(URLRequest(url: BASE.appendingPathComponent("prototipo/")))
  }
  // Al terminar de cargar: el universo va a pantalla completa; el panel, en ventana.
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    appLog("nav \(webView.url?.absoluteString ?? "-")")
    syncFullScreen()
    if onUniverse, !pendingJS.isEmpty {
      let js = pendingJS; pendingJS = []
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { js.forEach { webView.evaluateJavaScript($0) } }   // tras construir la escena
    }
  }
  func syncFullScreen() {
    guard window.isVisible else { return }
    let immersive = (web.url?.path.hasPrefix("/prototipo") ?? false) && !(web.url?.query?.contains("embed") ?? false)
    if immersive != window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
  }
  func openDetails() { web.load(URLRequest(url: BASE)) }

  func showWindow() {
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.syncFullScreen() }
  }

  // El panel solo puede usar el micrófono de su propio origen local.
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
               type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == "127.0.0.1" && origin.port == 7420 && type == .microphone ? .grant : .deny)
  }

  // Enlaces externos se abren en el navegador; la ventana de Kratos solo muestra el panel local.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let url = action.request.url, url.host != "127.0.0.1" { NSWorkspace.shared.open(url); return decisionHandler(.cancel) }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "Aceptar"); a.addButton(withTitle: "Cancelar")
    completionHandler(a.runModal() == .alertFirstButtonReturn)
  }

  // Mensajes del panel: «pulsar para hablar», voz y escucha.
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    guard let body = m.body as? [String: Any], let event = body["event"] as? String else { return }
    switch event {
    case "ptt": wake.pausedByPanel = body["active"] as? Bool ?? false
    case "speak":
      wake.pausedByPanel = true
      wake.speaker.say(body["text"] as? String ?? "") { [weak self] in
        self?.wake.pausedByPanel = false
        self?.web.evaluateJavaScript("window.kratosSpoke && window.kratosSpoke()")
      }
    case "hush": wake.speaker.stop()
    case "openBrowser": ConnectionsBrowser.shared.show(body["url"] as? String)
    case "exitImmersive": openDetails()
    case "wake", "mute":
      // Silenciar apaga también el detector: el micrófono queda cerrado del todo.
      let on = event == "mute" ? !(body["muted"] as? Bool ?? false) : (body["enabled"] as? Bool ?? wake.enabled)
      wake.enabled = on; render(wake.state, nil); heartbeat()
    case "config":
      for k in ["wakeWindow", "followUp", "sensitivity"] { if let v = body[k] as? Double { UserDefaults.standard.set(v, forKey: k) } }
    default: break
    }
  }

  func buildStatusItem() {
    status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menu = NSMenu()
    stateItem = NSMenuItem(title: "Iniciando…", action: nil, keyEquivalent: "")
    stateItem.isEnabled = false
    menu.addItem(stateItem)
    menu.addItem(.separator())
    menu.addItem(withTitle: "Universo KRATOS (pantalla completa)", action: #selector(openUniverseMenu), keyEquivalent: "u")
    menu.addItem(withTitle: "Panel de detalles", action: #selector(openDetailsMenu), keyEquivalent: "d")
    menu.addItem(withTitle: "Navegador de conexiones", action: #selector(openBrowserMenu), keyEquivalent: "b")
    wakeItem = menu.addItem(withTitle: "Escuchar «Kratos»", action: #selector(toggleWake), keyEquivalent: "")
    menu.addItem(.separator())
    menu.addItem(withTitle: "Parada de emergencia", action: #selector(emergency), keyEquivalent: "")
    menu.addItem(.separator())
    menu.addItem(withTitle: "Salir de Kratos", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    status.menu = menu
    render(.off, nil)
  }

  func render(_ s: WakeListener.State, _ msg: String?) {
    let symbol: String
    switch s {
    case .off: symbol = "mic.slash"
    case .denied, .error: symbol = "exclamationmark.triangle"
    case .listening, .followUp: symbol = "waveform.circle"
    case .hearing: symbol = "waveform.circle.fill"
    case .processing: symbol = "ellipsis.circle"
    case .speaking: symbol = "speaker.wave.2.circle"
    }
    status.button?.image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Kratos: \(s.rawValue)")
    status.button?.title = " Kratos"
    status.button?.imagePosition = .imageLeft
    stateItem.title = msg.map { "\(s.rawValue): \($0)" } ?? s.rawValue
    wakeItem.state = wake.enabled ? .on : .off
    let cfg = "{wakeWindow:\(wake.wakeWindow),followUp:\(wake.followUpSeconds),sensitivity:\(wake.sensitivity)}"
    let js = "window.kratosNativeState && window.kratosNativeState(\(jsString(s.rawValue)), \(wake.enabled), \(cfg))"
    web?.evaluateJavaScript(js)
    if s == .denied { stateItem.title = "Sin permiso de micrófono: Ajustes › Privacidad › Micrófono" }
  }

  func jsString(_ s: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [s])
    return String(String(data: data, encoding: .utf8)!.dropFirst().dropLast())
  }

  func heartbeat() {
    let listening = wake.enabled && [.listening, .hearing, .processing, .followUp, .speaking].contains(wake.state)
    API.post("/api/voice/heartbeat", ["listening": listening, "muted": !wake.enabled])
    // Ajustes que puede cambiar KRATOS por voz: el tiempo de conversación sin repetir «Kratos»
    API.send(API.request("/api/ajustes")) { r in
      if let f = r?["follow_up"] as? Double, f >= 5, f <= 300 { UserDefaults.standard.set(f, forKey: "followUp") }
    }
  }

  // Alarmas y avisos de la agenda: a su hora, encender la pantalla, abrir el universo y decirlo en voz alta.
  func checkAgenda() {
    API.post("/api/agenda/claim", [:]) { [weak self] r in
      guard let self, let due = r?["due"] as? [[String: Any]], !due.isEmpty else { return }
      DispatchQueue.main.async {
        let wake = Process(); wake.executableURL = URL(fileURLWithPath: "/usr/bin/caffeinate"); wake.arguments = ["-u", "-t", "30"]
        try? wake.run()   // enciende la pantalla si estaba apagada
        self.showWindow()
        let alarm = due.contains { ($0["kind"] as? String) == "alarma" }
        if alarm { NSSound(named: "Glass")?.play() }
        let text = due.compactMap { $0["spoken"] as? String }.joined(separator: " ")
        self.universeJS("window.kratosWoke && window.kratosWoke()")
        DispatchQueue.main.asyncAfter(deadline: .now() + (alarm ? 1.5 : 0.6)) { self.wake.speaker.say(text) }
      }
    }
  }

  @objc func openBrowserMenu() { ConnectionsBrowser.shared.show(nil) }
  @objc func openPanel() { showWindow() }
  @objc func openUniverseMenu() { showWindow(); openUniverse() }
  @objc func openDetailsMenu() { showWindow(); openDetails() }
  @objc func toggleWake() { wake.enabled.toggle(); render(wake.state, nil); heartbeat() }
  @objc func emergency() {
    API.post("/api/emergency-stop", [:]) { [weak self] r in
      self?.alert("Parada de emergencia activada", r == nil ? "No se pudo contactar con el servicio." : "Todo el trabajo se ha detenido. Reanuda desde el panel.")
      self?.web.evaluateJavaScript("window.kratosRefresh && window.kratosRefresh()")
    }
  }

  func alert(_ title: String, _ text: String) {
    let a = NSAlert(); a.messageText = title; a.informativeText = text; a.runModal()
  }

  func buildMainMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem(); main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Ocultar Kratos", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: "Salir de Kratos", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "Edición")
    edit.addItem(withTitle: "Deshacer", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Cortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Pegar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Seleccionar todo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    let winItem = NSMenuItem(); main.addItem(winItem)
    let win = NSMenu(title: "Ventana")
    win.addItem(withTitle: "Cerrar ventana", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    win.addItem(withTitle: "Minimizar", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
    winItem.submenu = win
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
