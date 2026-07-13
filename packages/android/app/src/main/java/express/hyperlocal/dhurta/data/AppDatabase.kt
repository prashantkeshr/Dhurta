package express.hyperlocal.dhurta.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Room persistence for the Android host. Schema mirrors the desktop SQLite
 * layout (settings, bookmarks, history) so ecosystem behaviour is consistent.
 *
 * Migrations are explicit and versioned; [MIGRATION_1_2] shows the pattern for
 * a thread-safe, non-destructive upgrade. Room applies migrations inside a
 * transaction, so a failure rolls back rather than corrupting the store.
 */
@Database(
    entities = [SettingEntity::class, BookmarkEntity::class],
    version = 2,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun settingDao(): SettingDao
    abstract fun bookmarkDao(): BookmarkDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        /** v1 → v2: add the ordered-index column used for drag-reorder favourites. */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE bookmarks ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0"
                )
            }
        }

        fun get(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "dhurta.db",
                )
                    .addMigrations(MIGRATION_1_2)
                    .fallbackToDestructiveMigrationOnDowngrade()
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
