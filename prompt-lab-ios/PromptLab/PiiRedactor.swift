import Foundation

/// Send-time redaction. Pattern text, labels, and thresholds come from
/// `pii-patterns.json`, the same spec the extension engine compiles.
struct PiiRedactor {
    let spec: PiiSpec

    private let detectors: [Detector]
    private let trailingProse: NSRegularExpression
    private let secretReference: NSRegularExpression
    private let envSecretSegment: NSRegularExpression
    private let pemHeader: NSRegularExpression
    private let pemEnd: NSRegularExpression
    private let jwtAssigned: NSRegularExpression
    private let emailLocal: NSRegularExpression
    private let emailDomain: NSRegularExpression
    private let emailTLD: NSRegularExpression
    private let asciiWord: NSRegularExpression
    private let schemeChar: NSRegularExpression
    private let schemeStart: NSRegularExpression
    private let passphraseWord: NSRegularExpression
    private let envAssignment: NSRegularExpression
    private let proseWords: Set<String>

    static let shared: PiiRedactor = {
        let bundles = [Bundle(for: PiiRedactorBundleToken.self), Bundle.main]
        for bundle in bundles {
            if let url = bundle.url(forResource: "pii-patterns", withExtension: "json"),
               let data = try? Data(contentsOf: url),
               let redactor = try? PiiRedactor(data: data) {
                return redactor
            }
        }
        fatalError("Prompt Lab is missing the shared sensitive-data patterns.")
    }()

    init(data: Data) throws {
        let spec = try JSONDecoder().decode(PiiSpec.self, from: data)
        try self.init(spec: spec)
    }

    init(spec: PiiSpec) throws {
        self.spec = spec
        let constants = spec.constants
        trailingProse = try Self.compile(constants.trailingProsePunctuation, label: "trailing punctuation")
        secretReference = try Self.compile(constants.secretReference, label: "secret reference")
        envSecretSegment = try Self.compile(constants.envSecretSegment, flags: "i", label: "env secret segment")
        pemHeader = try Self.compile(constants.pemHeader, label: "pem header")
        pemEnd = try Self.compile(constants.pemEnd, label: "pem end")
        jwtAssigned = try Self.compile(constants.jwtAssignmentPrefix, flags: "i", label: "jwt assignment")
        emailLocal = try Self.compile(constants.emailLocalChar, label: "email local")
        emailDomain = try Self.compile(constants.emailDomainChar, label: "email domain")
        emailTLD = try Self.compile(constants.emailTld, label: "email tld")
        asciiWord = try Self.compile(constants.asciiWord, label: "word")
        schemeChar = try Self.compile(constants.schemeChar, label: "scheme")
        schemeStart = try Self.compile(constants.schemeStartChar, label: "scheme start")
        passphraseWord = try Self.compile(constants.passphraseWord, label: "passphrase")
        envAssignment = try Self.compile(constants.envAssignment, label: "env assignment")
        proseWords = Set(constants.proseWords)
        detectors = try spec.detectors.map { detector in
            let regex = try detector.regex.map { pattern in
                try Self.compile(pattern, flags: detector.flags, label: detector.id)
            }
            return Detector(spec: detector, regex: regex)
        }
    }

    func scan(_ text: String) -> PiiScan {
        let source = text as NSString
        if source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return PiiScan(hasPII: false, findings: [])
        }
        var findings: [PiiFinding] = []
        var seen = Set<String>()
        for detector in detectors {
            var matches: [RawMatch] = []
            switch detector.find {
            case "emails":
                matches.append(contentsOf: findEmails(source))
            case "credentialBlocks":
                matches.append(contentsOf: findPrivateKeys(source))
                matches.append(contentsOf: findJwts(source))
            case "envAndUserinfo":
                matches.append(contentsOf: findEnvSecrets(source))
                matches.append(contentsOf: findUrlUserinfo(source))
            default:
                break
            }
            if let regex = detector.regex {
                matches.append(contentsOf: regexMatches(regex, in: source))
            }
            for match in matches {
                guard let finding = makeFinding(detector, match, index: findings.count, source: source) else { continue }
                let key = "\(finding.type):\(finding.start):\(finding.end):\(finding.value)"
                if seen.insert(key).inserted {
                    findings.append(finding)
                }
            }
        }
        let resolved = resolveOverlaps(findings, source: source)
        return PiiScan(hasPII: !resolved.isEmpty, findings: resolved)
    }

    func redact(
        _ text: String,
        style: PiiPlaceholderStyle = .plain,
        findings explicit: [PiiFinding]? = nil
    ) -> String {
        let source = text as NSString
        let supplied = explicit ?? scan(text).findings
        let usable = supplied.filter { $0.end > $0.start }
        let sorted = Array(resolveOverlaps(usable, source: source).reversed())
        if sorted.isEmpty { return text }

        var redactionMap: [String: String] = [:]
        var typeCounters: [String: Int] = [:]
        var redacted = text
        for finding in sorted {
            let value = finding.value.isEmpty ? slice(source, finding.start, finding.end) : finding.value
            if value.isEmpty { continue }
            if redactionMap[value] == nil {
                let count = (typeCounters[finding.type] ?? 0) + 1
                typeCounters[finding.type] = count
                redactionMap[value] = formatPlaceholder(finding.placeholder, count, style)
            }
            let current = redacted as NSString
            redacted = slice(current, 0, finding.start) + (redactionMap[value] ?? "REDACTED") + slice(current, finding.end, current.length)
        }
        return redacted
    }

    func review(of text: String) -> SensitiveReview? {
        let scan = scan(text)
        guard scan.hasPII else { return nil }
        let redacted = redact(text, style: .brackets, findings: scan.findings)
        let replacements = replacementMap(for: scan.findings, in: text)
        let matches = scan.findings.map { finding in
            SensitiveReview.Match(
                id: finding.id,
                type: finding.type,
                label: finding.label,
                snippet: Self.displaySnippet(finding.snippet),
                replacement: replacements[finding.value] ?? "[\(finding.placeholder)]"
            )
        }
        var seen = Set<String>()
        let noticeParts = matches.map(\.replacement).filter { seen.insert($0).inserted }
        return SensitiveReview(
            id: UUID(),
            original: text,
            redacted: redacted,
            matches: matches,
            notice: "Redacted before sending: \(noticeParts.joined(separator: ", "))."
        )
    }

    private func replacementMap(for findings: [PiiFinding], in text: String) -> [String: String] {
        let source = text as NSString
        let sorted = Array(resolveOverlaps(findings.filter { $0.end > $0.start }, source: source).reversed())
        var map: [String: String] = [:]
        var typeCounters: [String: Int] = [:]
        for finding in sorted {
            let value = finding.value.isEmpty ? slice(source, finding.start, finding.end) : finding.value
            if value.isEmpty || map[value] != nil { continue }
            let count = (typeCounters[finding.type] ?? 0) + 1
            typeCounters[finding.type] = count
            map[value] = formatPlaceholder(finding.placeholder, count, .brackets)
        }
        return map
    }
}

enum PiiPlaceholderStyle {
    case plain
    case brackets
}

struct PiiScan: Equatable {
    let hasPII: Bool
    let findings: [PiiFinding]
}

struct PiiFinding: Equatable {
    let id: String
    let type: String
    let label: String
    let description: String
    let placeholder: String
    let snippet: String
    let value: String
    let start: Int
    let end: Int
}

struct SensitiveReview: Identifiable, Equatable {
    let id: UUID
    let original: String
    let redacted: String
    let matches: [Match]
    let notice: String

    struct Match: Identifiable, Equatable {
        let id: String
        let type: String
        let label: String
        let snippet: String
        let replacement: String
    }
}

struct PiiSpec: Decodable {
    struct Constants: Decodable {
        let secretMinLength: Int
        let envValueMinLength: Int
        let bearerMinLength: Int
        let urlSecretMinLength: Int
        let pemHeaderMax: Int
        let pemMaxSpan: Int
        let jwtPrefixWindow: Int
        let emailLocalMax: Int
        let emailDomainMax: Int
        let tldMin: Int
        let tldMax: Int
        let snippetMax: Int
        let snippetHead: Int
        let trailingProsePunctuation: String
        let secretReference: String
        let envSecretSegment: String
        let pemHeader: String
        let pemEnd: String
        let pemBegin: String
        let pemEndMarker: String
        let jwtAssignmentPrefix: String
        let emailLocalChar: String
        let emailDomainChar: String
        let emailTld: String
        let asciiWord: String
        let schemeChar: String
        let schemeStartChar: String
        let passphraseWord: String
        let envAssignment: String
        let userinfoBoundaries: String
        let proseWords: [String]
    }

    struct DetectorSpec: Decodable {
        let id: String
        let label: String
        let description: String
        let placeholder: String
        let regex: String?
        let flags: String
        let find: String?
        let extract: String?
        let validate: String?
    }

    let constants: Constants
    let detectors: [DetectorSpec]
}

private struct Detector {
    let id: String
    let label: String
    let description: String
    let placeholder: String
    let regex: NSRegularExpression?
    let find: String?
    let extract: String?
    let validate: String?

    init(spec: PiiSpec.DetectorSpec, regex: NSRegularExpression?) {
        id = spec.id
        label = spec.label
        description = spec.description
        placeholder = spec.placeholder
        self.regex = regex
        find = spec.find
        extract = spec.extract
        validate = spec.validate
    }
}

private struct RawMatch {
    var full: String
    var index: Int
    var groups: [String?]
    var env = false
    var url = false
}

private final class PiiRedactorBundleToken: NSObject {}

private extension PiiRedactor {
    static func compile(_ pattern: String, flags: String = "", label: String) throws -> NSRegularExpression {
        var options: NSRegularExpression.Options = []
        if flags.contains("i") { options.insert(.caseInsensitive) }
        do {
            return try NSRegularExpression(pattern: asciiDigits(pattern), options: options)
        } catch {
            throw RedactorError.compileFailed(label)
        }
    }

    /// ICU treats `\d` as any Unicode digit and `\b` as a Unicode word
    /// boundary. The shared patterns use JavaScript's ASCII meaning: digits
    /// are `[0-9]`, and a boundary sits between `[A-Za-z0-9_]` and anything else.
    static let asciiWordBoundary = "(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))"
    static let asciiNonWordBoundary = "(?:(?<=[A-Za-z0-9_])(?=[A-Za-z0-9_])|(?<![A-Za-z0-9_])(?![A-Za-z0-9_]))"

    static func asciiDigits(_ pattern: String) -> String {
        var result = ""
        var escaped = false
        for character in pattern {
            if escaped {
                switch character {
                case "d": result += "[0-9]"
                case "b": result += asciiWordBoundary
                case "B": result += asciiNonWordBoundary
                default: result += "\\\(character)"
                }
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else {
                result.append(character)
            }
        }
        if escaped { result.append("\\") }
        return result
    }

    static func displaySnippet(_ snippet: String) -> String {
        let text = snippet as NSString
        guard text.length > 32 else { return snippet }
        return text.substring(to: 8) + "..." + text.substring(from: text.length - 6)
    }

    func formatPlaceholder(_ placeholder: String, _ index: Int, _ style: PiiPlaceholderStyle) -> String {
        let base = index > 1 ? "\(placeholder)_\(index)" : placeholder
        return style == .brackets ? "[\(base)]" : base
    }

    func snippet(of value: String) -> String {
        let text = value as NSString
        if text.length > spec.constants.snippetMax {
            return text.substring(to: spec.constants.snippetHead) + "..."
        }
        return value
    }

    func slice(_ text: NSString, _ start: Int, _ end: Int) -> String {
        let lower = max(0, min(start, text.length))
        let upper = max(lower, min(end, text.length))
        return text.substring(with: NSRange(location: lower, length: upper - lower))
    }

    func unit(_ text: NSString, _ index: Int) -> String {
        guard index >= 0, index < text.length else { return "" }
        return text.substring(with: NSRange(location: index, length: 1))
    }

    func code(_ text: NSString, _ index: Int) -> unichar? {
        guard index >= 0, index < text.length else { return nil }
        return text.character(at: index)
    }

    func indexOf(_ text: NSString, _ needle: String, from: Int = 0) -> Int {
        guard from < text.length else { return -1 }
        let start = max(0, from)
        let range = text.range(of: needle, options: [], range: NSRange(location: start, length: text.length - start))
        return range.location == NSNotFound ? -1 : range.location
    }

    func lastIndexOf(_ text: String, _ needle: String, from: Int? = nil) -> Int {
        let ns = text as NSString
        guard ns.length > 0 else { return -1 }
        let limit = min(ns.length, from ?? ns.length)
        guard limit > 0 else { return -1 }
        let range = ns.range(of: needle, options: .backwards, range: NSRange(location: 0, length: limit))
        return range.location == NSNotFound ? -1 : range.location
    }

    func test(_ regex: NSRegularExpression, _ text: String) -> Bool {
        let ns = text as NSString
        let range = NSRange(location: 0, length: ns.length)
        return regex.firstMatch(in: text, options: [], range: range) != nil
    }

    func testUnit(_ regex: NSRegularExpression, _ text: NSString, _ index: Int) -> Bool {
        let character = unit(text, index)
        return !character.isEmpty && test(regex, character)
    }

    func firstGroups(_ regex: NSRegularExpression, in text: String) -> RawMatch? {
        regexMatches(regex, in: text as NSString).first
    }

    func regexMatches(_ regex: NSRegularExpression, in text: NSString) -> [RawMatch] {
        let range = NSRange(location: 0, length: text.length)
        return regex.matches(in: text as String, options: [], range: range).map { result in
            var groups: [String?] = []
            for index in 0..<result.numberOfRanges {
                let group = result.range(at: index)
                if group.location == NSNotFound {
                    groups.append(nil)
                } else {
                    groups.append(text.substring(with: group))
                }
            }
            let full = groups.first.flatMap { $0 } ?? ""
            return RawMatch(full: full, index: result.range.location, groups: groups)
        }
    }

    func wholeMatch(_ value: String, index: Int) -> RawMatch {
        RawMatch(full: value, index: index, groups: [value])
    }

    func isBlankBoundary(_ text: NSString, _ index: Int) -> Bool {
        guard let code = code(text, index) else { return true }
        let character = String(UnicodeScalar(code) ?? UnicodeScalar(0))
        return spec.constants.userinfoBoundaries.contains(character)
    }

    func isKeyChar(_ text: NSString, _ index: Int) -> Bool {
        guard let code = code(text, index) else { return false }
        return (48...57).contains(code) || (65...90).contains(code) || (97...122).contains(code) || code == 45 || code == 95
    }

    func stripTrailingSpaceTab(_ raw: String) -> String {
        let text = raw as NSString
        var end = text.length
        while let code = code(text, end - 1), code == 32 || code == 9 {
            end -= 1
        }
        return text.substring(to: end)
    }

    func stripTrailingProse(_ raw: String) -> String {
        guard let match = trailingProse.firstMatch(in: raw, options: [], range: NSRange(location: 0, length: (raw as NSString).length)) else {
            return raw
        }
        return (raw as NSString).substring(to: match.range.location)
    }

    func envNameIsSecret(_ name: String) -> Bool {
        name.split(separator: "_").contains { test(envSecretSegment, String($0)) }
    }

    func parseEnvValue(_ raw: String) -> (value: String, offset: Int) {
        let text = raw as NSString
        if raw.hasPrefix("\"") {
            let end = indexOf(text, "\"", from: 1)
            if end > 1 { return (slice(text, 1, end), 1) }
            return (stripTrailingSpaceTab(text.substring(from: 1)), 1)
        }
        if raw.hasPrefix("'") {
            let end = indexOf(text, "'", from: 1)
            if end > 1 { return (slice(text, 1, end), 1) }
            return (stripTrailingSpaceTab(text.substring(from: 1)), 1)
        }
        var lead = 0
        while let code = code(text, lead), code == 32 || code == 9 { lead += 1 }
        let body = text.substring(from: lead) as NSString
        var stop = body.length
        for index in 0..<body.length {
            let code = body.character(at: index)
            if code == 38 || code == 59 || code == 13 {
                stop = index
                break
            }
        }
        return (stripTrailingSpaceTab(body.substring(to: stop)), lead)
    }

    func findEnvSecrets(_ source: NSString) -> [RawMatch] {
        var found: [RawMatch] = []
        func visit(_ line: String, _ start: Int) {
            let text = line as NSString
            var lead = 0
            while let code = code(text, lead), code == 32 || code == 9 { lead += 1 }
            var body = text.substring(from: lead)
            if body.hasSuffix("\r") { body.removeLast() }
            guard let assignment = firstGroups(envAssignment, in: body),
                  let name = assignment.groups.count > 1 ? assignment.groups[1] : nil,
                  envNameIsSecret(name) else { return }
            let rawValue = assignment.groups.count > 2 ? (assignment.groups[2] ?? "") : ""
            let parsed = parseEnvValue(rawValue)
            if parsed.value.isEmpty || (parsed.value as NSString).length < spec.constants.envValueMinLength || test(secretReference, parsed.value) {
                return
            }
            let valueStart = (body as NSString).length - (rawValue as NSString).length + parsed.offset
            var match = wholeMatch(parsed.value, index: start + lead + valueStart)
            match.env = true
            found.append(match)
        }
        var lineStart = 0
        for index in 0..<source.length {
            if source.character(at: index) != 10 { continue }
            visit(slice(source, lineStart, index), lineStart)
            lineStart = index + 1
        }
        visit(slice(source, lineStart, source.length), lineStart)
        return found
    }

    func findUrlUserinfo(_ source: NSString) -> [RawMatch] {
        var found: [RawMatch] = []
        var from = 0
        while from < source.length {
            let scheme = indexOf(source, "://", from: from)
            if scheme < 0 { break }
            var start = scheme - 1
            while start >= 0 && testUnit(schemeChar, source, start) { start -= 1 }
            start += 1
            if start >= scheme || !testUnit(schemeStart, source, start) {
                from = scheme + 3
                continue
            }
            var index = scheme + 3
            let userStart = index
            while index < source.length && !isBlankBoundary(source, index) { index += 1 }
            if unit(source, index) != ":" || index == userStart {
                from = scheme + 3
                continue
            }
            let user = slice(source, userStart, index)
            index += 1
            let passStart = index
            while index < source.length && !isBlankBoundary(source, index) { index += 1 }
            let password = slice(source, passStart, index)
            if unit(source, index) != "@" || (password as NSString).length < 3 || test(secretReference, user) || test(secretReference, password) {
                from = scheme + 3
                continue
            }
            var match = wholeMatch("\(user):\(password)", index: userStart)
            match.url = true
            found.append(match)
            from = index + 1
        }
        return found
    }

    func normalizePassphrase(_ raw: String) -> String {
        let trimmed = stripTrailingProse(stripTrailingSpaceTab(raw))
        let words = splitWords(trimmed)
        let passphrase = words.count >= 2 && words.count <= 16 && words.allSatisfy { word in
            let bare = stripTrailingProse(word)
            return (bare as NSString).length >= 2
                && test(passphraseWord, bare)
                && !proseWords.contains(bare.lowercased())
        }
        if passphrase { return trimmed }
        return stripTrailingProse(firstToken(raw))
    }

    func splitWords(_ text: String) -> [String] {
        let source = text as NSString
        var words: [String] = []
        var current = ""
        func flush() {
            if !current.isEmpty {
                words.append(current)
                current = ""
            }
        }
        for index in 0..<source.length {
            let code = source.character(at: index)
            if code == 32 || code == 9 {
                flush()
            } else if let scalar = UnicodeScalar(code) {
                current.append(Character(scalar))
            }
        }
        flush()
        return words
    }

    func firstToken(_ raw: String) -> String {
        let source = raw as NSString
        var index = 0
        while let code = code(source, index), code != 32 && code != 9 { index += 1 }
        return source.substring(to: index)
    }

    func group(_ match: RawMatch, _ index: Int) -> String? {
        guard match.groups.indices.contains(index) else { return nil }
        return match.groups[index]
    }

    func extractSecret(_ match: RawMatch) -> String {
        if match.env || match.url { return match.full }
        if let value = group(match, 1) { return value }
        if let value = group(match, 2) { return value }
        if let value = group(match, 3) { return normalizePassphrase(value) }
        if let value = group(match, 4) { return stripTrailingProse(value) }
        return ""
    }

    func locateSecret(_ match: RawMatch, _ value: String) -> Int {
        if match.env || match.url { return 0 }
        let separator = max(lastIndexOf(match.full, "="), lastIndexOf(match.full, ":"))
        let from = separator >= 0 ? separator + 1 : 0
        let at = indexOf(match.full as NSString, value, from: from)
        return at >= 0 ? at : max(lastIndexOf(match.full, value), 0)
    }

    func secretValueOk(_ value: String, _ match: RawMatch) -> Bool {
        if value.isEmpty || test(secretReference, value) { return false }
        let length = (value as NSString).length
        if match.env { return length >= spec.constants.envValueMinLength }
        if match.url { return length >= spec.constants.urlSecretMinLength }
        return length >= spec.constants.secretMinLength
    }

    func findPrivateKeys(_ source: NSString) -> [RawMatch] {
        var found: [RawMatch] = []
        var from = 0
        let begin = spec.constants.pemBegin
        let endMarker = spec.constants.pemEndMarker
        while from < source.length {
            let start = indexOf(source, begin, from: from)
            if start < 0 { break }
            let headerClose = indexOf(source, "-----", from: start + (begin as NSString).length)
            if headerClose < 0 { break }
            let header = slice(source, start + (begin as NSString).length, headerClose)
            if (header as NSString).length > spec.constants.pemHeaderMax || !test(pemHeader, header) {
                from = start + (begin as NSString).length
                continue
            }
            let end = indexOf(source, endMarker, from: headerClose + 5)
            if end < 0 || end - start > spec.constants.pemMaxSpan {
                from = headerClose + 5
                continue
            }
            let tail = slice(source, end, min(source.length, end + spec.constants.snippetMax))
            guard let endMatch = firstGroups(pemEnd, in: tail) else {
                from = end + (endMarker as NSString).length
                continue
            }
            let stop = end + (endMatch.full as NSString).length
            found.append(wholeMatch(slice(source, start, stop), index: start))
            from = stop
        }
        return found
    }

    func scanJwt(_ source: NSString, _ start: Int) -> (end: Int?, resume: Int) {
        var index = start
        for segment in 0..<3 {
            if segment < 2 {
                if slice(source, index, index + 3) != "eyJ" { return (nil, start + 3) }
                index += 3
            }
            let segmentStart = index
            while isKeyChar(source, index) { index += 1 }
            let segmentLength = index - segmentStart
            if segment < 2 {
                if segmentLength < 8 || unit(source, index) != "." {
                    return (nil, unit(source, index) == "." ? start + 3 : max(index, start + 3))
                }
                index += 1
            } else if segmentLength < 8 {
                return (nil, start + 3)
            }
        }
        return (index, index)
    }

    func findJwts(_ source: NSString) -> [RawMatch] {
        var found: [RawMatch] = []
        var from = 0
        while from < source.length {
            let start = indexOf(source, "eyJ", from: from)
            if start < 0 { break }
            if start > 0 && testUnit(asciiWord, source, start - 1) {
                from = start + 3
                continue
            }
            let scanned = scanJwt(source, start)
            guard let end = scanned.end else {
                from = scanned.resume
                continue
            }
            let prefix = slice(source, max(0, start - spec.constants.jwtPrefixWindow), start)
            if test(jwtAssigned, prefix) {
                from = end
                continue
            }
            found.append(wholeMatch(slice(source, start, end), index: start))
            from = end
        }
        return found
    }

    func isUrlUserinfo(at index: Int, _ source: NSString) -> Bool {
        var cursor = index - 1
        while cursor >= 0 && !isBlankBoundary(source, cursor) { cursor -= 1 }
        if unit(source, cursor) != ":" { return false }
        cursor -= 1
        let userEnd = cursor
        while cursor >= 0 && !isBlankBoundary(source, cursor) { cursor -= 1 }
        if cursor == userEnd { return false }
        return slice(source, max(0, cursor - 2), cursor + 1) == "://"
    }

    func findEmails(_ source: NSString) -> [RawMatch] {
        var found: [RawMatch] = []
        var from = 0
        while from < source.length {
            let at = indexOf(source, "@", from: from)
            if at <= 0 {
                if at < 0 { break }
                from = at + 1
                continue
            }
            if isUrlUserinfo(at: at, source) {
                from = at + 1
                continue
            }
            var start = at - 1
            while start >= 0 && at - start <= spec.constants.emailLocalMax && testUnit(emailLocal, source, start) {
                start -= 1
            }
            start += 1
            if start == at || (start > 0 && testUnit(asciiWord, source, start - 1)) {
                from = at + 1
                continue
            }
            var end = at + 1
            let domainLimit = min(source.length, end + spec.constants.emailDomainMax)
            while end < domainLimit && testUnit(emailDomain, source, end) { end += 1 }
            while end > at + 1 && unit(source, end - 1) == "." { end -= 1 }
            let domain = slice(source, at + 1, end)
            let dot = lastIndexOf(domain, ".")
            let tld = dot >= 0 ? (domain as NSString).substring(from: dot + 1) : ""
            if dot <= 0 || (tld as NSString).length < spec.constants.tldMin || (tld as NSString).length > spec.constants.tldMax || !test(emailTLD, tld) {
                from = at + 1
                continue
            }
            if end < source.length && testUnit(asciiWord, source, end) {
                from = at + 1
                continue
            }
            found.append(wholeMatch(slice(source, start, end), index: start))
            from = end
        }
        return found
    }

    func makeFinding(_ detector: Detector, _ match: RawMatch, index: Int, source: NSString) -> PiiFinding? {
        let value: String
        switch detector.extract {
        case "group1":
            let group = self.group(match, 1)
            value = (group?.isEmpty == false ? group! : match.full)
        case "secret":
            value = extractSecret(match)
        default:
            value = match.full
        }
        if value.isEmpty { return nil }
        if detector.validate == "secretValue" {
            if !secretValueOk(value, match) { return nil }
        } else if detector.validate == "luhn" {
            if !luhnPasses(value) { return nil }
        } else if detector.validate == "bearerLength" {
            if (value as NSString).length < spec.constants.bearerMinLength { return nil }
        }

        let relative: Int
        if detector.extract != nil {
            if detector.extract == "secret" {
                relative = locateSecret(match, value)
            } else {
                relative = lastIndexOf(match.full, value)
            }
        } else {
            relative = 0
        }
        if relative < 0 { return nil }
        let start = match.index + relative
        let end = start + (value as NSString).length
        return PiiFinding(
            id: "\(detector.id):\(start):\(end):\(index)",
            type: detector.id,
            label: detector.label,
            description: detector.description,
            placeholder: detector.placeholder.isEmpty ? "REDACTED" : detector.placeholder,
            snippet: snippet(of: value),
            value: value,
            start: start,
            end: end
        )
    }

    func luhnPasses(_ digits: String) -> Bool {
        let source = digits as NSString
        var clean = ""
        for index in 0..<source.length {
            let code = source.character(at: index)
            if (48...57).contains(code), let scalar = UnicodeScalar(code) {
                clean.append(Character(scalar))
            }
        }
        if clean.count < 13 || clean.count > 19 { return false }
        var sum = 0
        var shouldDouble = false
        for character in clean.reversed() {
            var number = Int(String(character)) ?? 0
            if shouldDouble {
                number *= 2
                if number > 9 { number -= 9 }
            }
            sum += number
            shouldDouble.toggle()
        }
        return sum % 10 == 0
    }

    func resolveOverlaps(_ findings: [PiiFinding], source: NSString) -> [PiiFinding] {
        let ordered = findings.sorted { left, right in
            if left.start != right.start { return left.start < right.start }
            return left.end > right.end
        }
        var resolved: [PiiFinding] = []
        for finding in ordered {
            guard let last = resolved.last else {
                resolved.append(finding)
                continue
            }
            if finding.start >= last.end {
                resolved.append(finding)
            } else if finding.end > last.end {
                let value = slice(source, last.start, finding.end)
                resolved[resolved.count - 1] = PiiFinding(
                    id: last.id,
                    type: last.type,
                    label: last.label,
                    description: last.description,
                    placeholder: last.placeholder,
                    snippet: snippet(of: value),
                    value: value,
                    start: last.start,
                    end: finding.end
                )
            }
        }
        return resolved
    }
}

private enum RedactorError: Error {
    case compileFailed(String)
}
