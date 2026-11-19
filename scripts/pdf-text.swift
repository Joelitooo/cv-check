import Foundation
import PDFKit

guard CommandLine.arguments.count > 1 else {
  fputs("usage: pdf-text.swift <file.pdf>\n", stderr)
  exit(1)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let document = PDFDocument(url: url), let text = document.string, !text.isEmpty else {
  fputs("Could not read text from PDF\n", stderr)
  exit(1)
}

print(text)
