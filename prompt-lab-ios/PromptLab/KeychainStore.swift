import Foundation
import Security

protocol APIKeyStoring {
    func store(_ key: String) throws
    func retrieve() throws -> String?
    func delete() throws
}

struct KeychainStore: APIKeyStoring {
    private let service: String
    private let account: String

    init(
        service: String = "com.davehomeassist.promptlab",
        account: String = "anthropic-api-key"
    ) {
        self.service = service
        self.account = account
    }

    func store(_ key: String) throws {
        let value = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            try delete()
            return
        }
        let data = Data(value.utf8)
        let query = baseQuery
        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [
                kSecValueData: data,
                kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError(status: updateStatus)
        }

        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError(status: addStatus)
        }
    }

    func retrieve() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError(status: status)
        }
        guard let key = String(data: data, encoding: .utf8), !key.isEmpty else {
            throw KeychainError.invalidData
        }
        return key
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

struct KeychainError: LocalizedError, Equatable {
    let status: OSStatus
    private let isInvalidData: Bool

    init(status: OSStatus) {
        self.status = status
        self.isInvalidData = false
    }

    private init(status: OSStatus, isInvalidData: Bool) {
        self.status = status
        self.isInvalidData = isInvalidData
    }

    static let invalidData = KeychainError(status: errSecDecode, isInvalidData: true)

    var errorDescription: String? {
        if isInvalidData {
            return "The saved API key could not be decoded."
        }
        let message = SecCopyErrorMessageString(status, nil) as String?
        return message.map { "Keychain error: \($0)" } ?? "Keychain error \(status)."
    }
}
