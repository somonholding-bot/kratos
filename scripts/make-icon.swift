// Dibuja el icono de Kratos (1024×1024) con CoreGraphics. Uso: swift make-icon.swift salida.png
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "kratos.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext
let c = CGPoint(x: size / 2, y: size / 2)
let cyan = NSColor(calibratedRed: 0.22, green: 0.82, blue: 1.0, alpha: 1)

// Fondo: cuadrado redondeado azul noche con degradado radial
let bg = CGPath(roundedRect: CGRect(x: 72, y: 72, width: 880, height: 880), cornerWidth: 200, cornerHeight: 200, transform: nil)
ctx.addPath(bg); ctx.clip()
let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
  colors: [NSColor(calibratedRed: 0.05, green: 0.16, blue: 0.26, alpha: 1).cgColor, NSColor(calibratedRed: 0.01, green: 0.03, blue: 0.06, alpha: 1).cgColor] as CFArray,
  locations: [0, 1])!
ctx.drawRadialGradient(grad, startCenter: c, startRadius: 0, endCenter: c, endRadius: 560, options: [])

// Anillos
func ring(_ r: CGFloat, _ w: CGFloat, _ a: CGFloat, dash: [CGFloat]? = nil, rot: CGFloat = 0) {
  ctx.saveGState()
  ctx.translateBy(x: c.x, y: c.y); ctx.rotate(by: rot)
  ctx.setStrokeColor(cyan.withAlphaComponent(a).cgColor); ctx.setLineWidth(w)
  if let d = dash { ctx.setLineDash(phase: 0, lengths: d) }
  ctx.setShadow(offset: .zero, blur: 18, color: cyan.withAlphaComponent(0.8).cgColor)
  ctx.addArc(center: .zero, radius: r, startAngle: 0, endAngle: .pi * 2, clockwise: false); ctx.strokePath()
  ctx.restoreGState()
}
ring(380, 4, 0.35)
ring(330, 14, 0.55, dash: [150, 46], rot: 0.4)
ring(270, 6, 0.8, dash: [10, 18])
ring(215, 3, 0.5)

// Núcleo luminoso
ctx.saveGState()
ctx.setShadow(offset: .zero, blur: 90, color: cyan.cgColor)
let core = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
  colors: [NSColor.white.cgColor, cyan.cgColor, cyan.withAlphaComponent(0.15).cgColor] as CFArray, locations: [0, 0.45, 1])!
ctx.addArc(center: c, radius: 170, startAngle: 0, endAngle: .pi * 2, clockwise: false); ctx.clip()
ctx.drawRadialGradient(core, startCenter: c, startRadius: 0, endCenter: c, endRadius: 170, options: [])
ctx.restoreGState()

// Letra K
let font = NSFont.systemFont(ofSize: 230, weight: .heavy)
let k = NSAttributedString(string: "K", attributes: [.font: font, .foregroundColor: NSColor(calibratedRed: 0.0, green: 0.07, blue: 0.12, alpha: 0.92)])
let ks = k.size()
k.draw(at: CGPoint(x: c.x - ks.width / 2, y: c.y - ks.height / 2 + 6))

NSGraphicsContext.current = nil
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
