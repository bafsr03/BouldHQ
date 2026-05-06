import Cocoa

let url = URL(fileURLWithPath: "app-icon-square.png")
guard let img = NSImage(contentsOf: url) else { 
    print("Could not load image")
    exit(1) 
}
let size = img.size

let newImg = NSImage(size: size)
newImg.lockFocus()

let rect = NSRect(origin: .zero, size: size)

// Define the squircle area with standard macOS padding
let padding = size.width * 0.09
let iconRect = rect.insetBy(dx: padding, dy: padding)

// Create the squircle path
let path = NSBezierPath(roundedRect: iconRect, xRadius: iconRect.width * 0.225, yRadius: iconRect.height * 0.225)

// Draw a subtle outer border/glow to make it feel native
let context = NSGraphicsContext.current?.cgContext
context?.saveGState()
context?.setShadow(offset: .zero, blur: size.width * 0.01, color: NSColor.black.withAlphaComponent(0.5).cgColor)
NSColor(white: 0.1, alpha: 1.0).setFill()
path.fill()
context?.restoreGState()

// Add the clipping and draw the original image
context?.saveGState()
path.addClip()
img.draw(in: iconRect, from: NSRect(origin: .zero, size: size), operation: .sourceOver, fraction: 1.0)
context?.restoreGState()

// Add a very subtle inner border (highlight) for the native look
NSColor(white: 1.0, alpha: 0.15).setStroke()
let innerPath = NSBezierPath(roundedRect: iconRect.insetBy(dx: 1, dy: 1), xRadius: iconRect.width * 0.225, yRadius: iconRect.height * 0.225)
innerPath.lineWidth = size.width * 0.005
innerPath.stroke()

newImg.unlockFocus()

guard let cgImage = newImg.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("Could not create CGImage")
    exit(1)
}
let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
let data = bitmapRep.representation(using: .png, properties: [:])!
try! data.write(to: URL(fileURLWithPath: "app-icon-rounded.png"))
