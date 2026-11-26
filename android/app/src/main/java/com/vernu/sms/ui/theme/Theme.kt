package com.vernu.sms.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import kotlin.math.ln

// Material3 1.1 tinted raised surfaces with the primary colour; newer versions read these roles instead
private fun tinted(surface: Color, tint: Color, elevationDp: Float): Color =
    tint.copy(alpha = (4.5f * ln(elevationDp + 1f) + 2f) / 100f).compositeOver(surface)

private val LightColorScheme = lightColorScheme(
    primary = Orange700,
    onPrimary = Color.White,
    primaryContainer = OrangeLight,
    onPrimaryContainer = Orange900,
    secondary = Orange600,
    onSecondary = Color.White,
    secondaryContainer = OrangeLight,
    onSecondaryContainer = Orange900,
    background = Gray50,
    onBackground = Gray900,
    surface = Color.White,
    onSurface = Gray900,
    surfaceVariant = Gray100,
    onSurfaceVariant = Gray600,
    outline = Gray200,
    error = Red500,
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = tinted(Color.White, Orange700, 1f),
    surfaceContainer = tinted(Color.White, Orange700, 3f),
    surfaceContainerHigh = tinted(Color.White, Orange700, 6f),
    surfaceContainerHighest = Gray100,
)

private val DarkColorScheme = darkColorScheme(
    primary = Orange600,
    onPrimary = Color.White,
    primaryContainer = Orange900,
    onPrimaryContainer = OrangeLight,
    secondary = Orange700,
    onSecondary = Color.White,
    secondaryContainer = Orange900,
    onSecondaryContainer = OrangeLight,
    background = Gray900,
    onBackground = Gray100,
    surface = Color(0xFF1F2937),
    onSurface = Gray100,
    surfaceVariant = Color(0xFF374151),
    onSurfaceVariant = Gray400,
    outline = Color(0xFF4B5563),
    error = Red500,
    surfaceContainerLowest = Color(0xFF1F2937),
    surfaceContainerLow = tinted(Color(0xFF1F2937), Orange600, 1f),
    surfaceContainer = tinted(Color(0xFF1F2937), Orange600, 3f),
    surfaceContainerHigh = tinted(Color(0xFF1F2937), Orange600, 6f),
    surfaceContainerHighest = Color(0xFF374151),
)

@Composable
fun TextbeeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
            // Up to Android 14 the navigation bar stays dark, so its icons stay light there
            if (Build.VERSION.SDK_INT >= 35) {
                WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
