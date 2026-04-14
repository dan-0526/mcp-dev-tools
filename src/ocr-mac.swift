#!/usr/bin/env swift
/**
 * macOS Vision Framework OCR
 * 用法: swift ocr-mac.swift <image_path> [lang]
 * lang 默认 zh-Hans,en（中英文）
 * 输出 JSON: { "text": "...", "blocks": [...] }
 */

import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count >= 2 else {
    fputs("Usage: swift ocr-mac.swift <image_path> [lang]\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let langs = CommandLine.arguments.count >= 3
    ? CommandLine.arguments[2].split(separator: ",").map(String.init)
    : ["zh-Hans", "en"]

guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Error: cannot load image at \(imagePath)\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = langs
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([request])
} catch {
    fputs("Error: \(error.localizedDescription)\n", stderr)
    exit(1)
}

guard let observations = request.results else {
    print("{\"text\":\"\",\"blocks\":[]}")
    exit(0)
}

var blocks: [[String: Any]] = []
var fullText = ""

for obs in observations {
    guard let candidate = obs.topCandidates(1).first else { continue }
    let text = candidate.string
    let box = obs.boundingBox
    fullText += text + "\n"
    blocks.append([
        "text": text,
        "confidence": round(candidate.confidence * 1000) / 1000,
        "x": round(box.origin.x * 1000) / 1000,
        "y": round(box.origin.y * 1000) / 1000,
        "w": round(box.width * 1000) / 1000,
        "h": round(box.height * 1000) / 1000
    ])
}

let result: [String: Any] = [
    "text": fullText.trimmingCharacters(in: .whitespacesAndNewlines),
    "blocks": blocks
]

if let json = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
   let str = String(data: json, encoding: .utf8) {
    print(str)
}
