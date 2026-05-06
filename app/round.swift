import Cocoa
let url = URL(fileURLWithPath: "app-icon-square.png")
let img = NSImage(contentsOf: url)!
let size = img.size
let newImg = NSImage(size: size)
newImg.lockFocus()
let rect = NSRect(origin: .zero, size: size)
let path = NSBezierPath(roundedRect: rect, xRadius: size.width * 0.225, yRadius: size.height * 0.225)
path.addClip()
img.draw(in: rect)
newImg.unlockFocus()
let cgImage = newImg.cgImage(forProposedRect: nil, context: nil, hints: nil)!
let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
let data = bitmapRep.representation(using: .png, properties: [:])!
try! data.write(to: URL(fileURLWithPath: "app-icon-rounded.png"))
