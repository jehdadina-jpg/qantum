"""Run the whole platform with: python -m qantum"""

import os

import uvicorn


def main() -> None:
    uvicorn.run("qantum.api:app", host=os.getenv("QANTUM_HOST", "127.0.0.1"), port=int(os.getenv("QANTUM_PORT", "8000")))


if __name__ == "__main__":
    main()
