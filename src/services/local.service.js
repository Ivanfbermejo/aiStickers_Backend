import fs from "fs/promises";

export const localstorage = {
    getPublicUrl(filename) {
        return `https://animatedsticker.com/aistickers/${filename}`;
    }
};

export async function deleteUrl(ruta) {
    const path = `/var/www/html/aistickers/${ruta}`
    try {
        await fs.unlink(path);
    } catch (err) {
        console.error(`Error eliminando ${path}:`, err.message);
    }
}