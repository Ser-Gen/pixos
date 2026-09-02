# Archive fixtures

Four small archives, for `tests/archive.test.mjs`. Every one of them was made by the
vendored engine or by the system `zip`, and each exists to reach a different answer:

| file | what it is | what it proves |
|---|---|---|
| `plain.zip` | `a.txt`, `b.txt`, `sub/c.txt` | listing, extracting, extracting a subset |
| `locked.zip` | the same, ZipCrypto, password `secret` | wrong password ≠ corrupt archive |
| `secret.7z` | 7z with **encrypted headers**, password `secret` | an archive that cannot even be *listed* without one |
| `bundle.tar.gz` | a tar inside a gzip | that both layers come off, not just the outer one |

The corrupt and not-an-archive cases are made in the test by truncating and by random
bytes, because a damaged file is not worth keeping around.
