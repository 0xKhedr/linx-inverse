import base64
from cryptography.hazmat.primitives import serialization


class Decrypter:

    def __init__(self, private_key: str):
        self.private_key = serialization.load_der_private_key(base64.b64decode(private_key), password=None)

    def decrypt(self, data: str):
        numbers = self.private_key.private_numbers()
        n = numbers.public_numbers.n
        d = numbers.d
        block_size = (n.bit_length() + 7) // 8

        ciphertext = base64.b64decode(data)
        plaintext = bytearray()

        for offset in range(0, len(ciphertext), block_size):
            block = ciphertext[offset:offset + block_size]
            decrypted_int = pow(int.from_bytes(block, 'big'), d, n)
            decoded = decrypted_int.to_bytes(block_size, 'big')

            # PKCS#1 v1.5 unpadding
            if not decoded.startswith(b'\x00\x02'):
                raise ValueError('Invalid PKCS#1 block')

            sep = decoded.find(b'\x00', 2)
            if sep < 0:
                raise ValueError('Padding separator not found')

            plaintext.extend(decoded[sep + 1:])

        text = plaintext.decode('utf-8')
        return text


if __name__ == '__main__':
    import json

    with open('./resources/private_key.txt', encoding='utf-8') as private_key_file:
        private_key_data = private_key_file.read()
    private_key = str().join(private_key_data.splitlines())

    decrpter = Decrypter(private_key)

    encryptData = input('encryptData: ').strip()
    decryptData = decrpter.decrypt(encryptData)

    print(json.dumps(json.loads(decryptData), ensure_ascii=False, indent=4))
